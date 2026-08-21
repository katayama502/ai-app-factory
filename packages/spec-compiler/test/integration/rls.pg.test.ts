import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { quoteIdent, quoteLiteral } from "@aiappfactory/expr";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, applyPlatformBootstrap, compileAppSpec } from "../../src/index.js";

/**
 * Proves the compiled RLS policies actually enforce isolation against a REAL
 * PostgreSQL server — not just that the generated SQL text looks plausible. This is
 * the closest thing packages/spec-compiler has to security tests S-01/S-02/S-17
 * (02_SECURITY §12) until the full Security Gate / e2e suite exists.
 *
 * Requires a reachable local Postgres superuser at 127.0.0.1:5432 (this repo's dev
 * setup uses Homebrew's postgresql@14, trust-authenticated on 127.0.0.1). Everything
 * this test creates (one throwaway database + one throwaway role) is dropped in
 * afterAll. Run via `pnpm test:integration`, NOT part of the default `pnpm test` —
 * CI doesn't have a Postgres server wired up yet (tracked in ROADMAP.md), so this is
 * a local/manual verification step for now.
 */

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? "hayato";
const TEST_DB = `aiaf_spec_compiler_test_${Date.now()}`;
const APP_ROLE_PASSWORD = "test-only-not-a-real-secret";

const templatesDir = join(import.meta.dirname, "..", "..", "..", "..", "templates");

let adminPool: pg.Pool;
let appRolePool: pg.Pool;

let deptSales: string;
let deptOther: string;
let alice: string; // sales_member, dept-sales
let bob: string; // sales_member, dept-sales
let carol: string; // sales_manager, dept-sales
let dave: string; // sales_manager, dept-other

let schemaName: string;
let roleName: string;

beforeAll(async () => {
  const bootstrapPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await bootstrapPool.query(`CREATE DATABASE ${quoteIdent(TEST_DB)}`);
  await bootstrapPool.end();

  adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: TEST_DB });

  await applyPlatformBootstrap(adminPool);

  deptSales = randomUUID();
  deptOther = randomUUID();
  alice = randomUUID();
  bob = randomUUID();
  carol = randomUUID();
  dave = randomUUID();

  await adminPool.query(`INSERT INTO public.departments (id) VALUES ($1), ($2)`, [deptSales, deptOther]);
  await adminPool.query(
    `INSERT INTO public.users (id, department_id) VALUES ($1, $2), ($3, $2), ($4, $2), ($5, $6)`,
    [alice, deptSales, bob, carol, dave, deptOther]
  );

  const source = readFileSync(join(templatesDir, "sales-daily-report", "app.yaml"), "utf-8");
  const parsed = parseAppSpecYaml(source);
  if (!parsed.ok) throw new Error(`template failed to validate: ${JSON.stringify(parsed.issues)}`);

  const migration = compileAppSpec(parsed.spec, { rolePassword: APP_ROLE_PASSWORD });
  schemaName = migration.schemaName;
  roleName = migration.roleName;
  await applyMigration(adminPool, migration);

  // Local dev Postgres is trust-authenticated on 127.0.0.1 (pg_hba.conf) — the role's
  // password is set for realism but isn't what actually gates this connection in this
  // environment. Production auth (scram-sha-256) is the platform's concern, not this test's.
  appRolePool = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleName, password: APP_ROLE_PASSWORD, database: TEST_DB });
}, 30_000);

afterAll(async () => {
  await appRolePool?.end();
  if (adminPool) {
    if (roleName) {
      await adminPool.query(`DROP OWNED BY ${quoteIdent(roleName)}`).catch(() => {});
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`).catch(() => {});
    }
    await adminPool.end();
  }
  const cleanupPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await cleanupPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(TEST_DB)} WITH (FORCE)`).catch(() => {});
  await cleanupPool.end();
}, 30_000);

const dailyReportTable = () => `${quoteIdent(schemaName)}.${quoteIdent("DailyReport")}`;

/** Runs `fn` inside a transaction with the given session principal set (ADR-007 §7.1 SET LOCAL pattern). */
async function asUser(
  userId: string,
  department: string,
  roles: string[],
  fn: (client: pg.PoolClient) => Promise<void>
): Promise<void> {
  const client = await appRolePool.connect();
  try {
    // `SET LOCAL` does not accept bind parameters — Postgres requires a literal here.
    // Values are test-controlled UUIDs/role names, but quoteLiteral is used anyway
    // rather than trusting that.
    await client.query("BEGIN");
    await client.query(`SET LOCAL factory.user_id = ${quoteLiteral(userId)}`);
    await client.query(`SET LOCAL factory.department = ${quoteLiteral(department)}`);
    await client.query(`SET LOCAL factory.roles = ${quoteLiteral(roles.join(","))}`);
    await fn(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertReport(userId: string, department: string, roles: string[], amount: number): Promise<void> {
  await asUser(userId, department, roles, async (client) => {
    await client.query(
      `INSERT INTO ${dailyReportTable()} ("reportDate", "customerName", amount, "author") VALUES (CURRENT_DATE, 'Acme', $1, $2)`,
      [amount, userId]
    );
  });
}

describe("RLS enforcement against a real Postgres server (sales-daily-report template)", () => {
  it("a sales_member can insert their own report", async () => {
    await expect(insertReport(alice, deptSales, ["sales_member"], 100)).resolves.not.toThrow();
    await expect(insertReport(bob, deptSales, ["sales_member"], 200)).resolves.not.toThrow();
  });

  it("read:own — a sales_member sees only their own rows", async () => {
    await asUser(alice, deptSales, ["sales_member"], async (client) => {
      const { rows } = await client.query(`SELECT "author" FROM ${dailyReportTable()}`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.author === alice)).toBe(true);
    });
  });

  it("read:dept — a sales_manager in the same department sees BOTH alice's and bob's rows via department_of()", async () => {
    await asUser(carol, deptSales, ["sales_manager"], async (client) => {
      const { rows } = await client.query(`SELECT "author" FROM ${dailyReportTable()}`);
      const authors = new Set(rows.map((r) => r.author));
      expect(authors.has(alice)).toBe(true);
      expect(authors.has(bob)).toBe(true);
    });
  });

  it("read:dept — a sales_manager in a DIFFERENT department sees nothing", async () => {
    await asUser(dave, deptOther, ["sales_manager"], async (client) => {
      const { rows } = await client.query(`SELECT * FROM ${dailyReportTable()}`);
      expect(rows.length).toBe(0);
    });
  });

  it("fail-closed: no factory.roles set at all → zero rows, not everything", async () => {
    const client = await appRolePool.connect();
    try {
      await client.query("BEGIN");
      // deliberately do NOT set factory.roles/user_id/department
      const { rows } = await client.query(`SELECT * FROM ${dailyReportTable()}`);
      expect(rows.length).toBe(0);
      await client.query("COMMIT");
    } catch (error) {
      // A dangling aborted transaction on a released connection would poison
      // whichever test the pool hands this same connection to next.
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  it("update:own — alice can update her own row but not bob's (0 rows affected, no error)", async () => {
    await asUser(alice, deptSales, ["sales_member"], async (client) => {
      const own = await client.query(`UPDATE ${dailyReportTable()} SET amount = 999 WHERE "author" = $1`, [alice]);
      expect(own.rowCount).toBeGreaterThan(0);

      const others = await client.query(`UPDATE ${dailyReportTable()} SET amount = 1 WHERE "author" = $1`, [bob]);
      expect(others.rowCount).toBe(0);
    });
  });

  it("DELETE is rejected outright — no role in this Spec is granted delete, so the base GRANT never included it", async () => {
    await asUser(alice, deptSales, ["sales_member"], async (client) => {
      await expect(client.query(`DELETE FROM ${dailyReportTable()}`)).rejects.toThrow(/permission denied/);
    });
  });

  it("the app role cannot read the Control Plane's users/departments tables directly (only via the resolver function)", async () => {
    const client = await appRolePool.connect();
    try {
      await expect(client.query(`SELECT * FROM public.users`)).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });
});
