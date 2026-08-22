import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { quoteIdent } from "@aiappfactory/expr";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, applyPlatformBootstrap, archiveApp, compileAppSpec } from "../../src/index.js";

/**
 * Proves `archiveApp` (04_IMPLEMENTATION E9-8, "ARCHIVED 時のリソース回収（DBスキーマ /
 * ロール ...）") actually reverses provisioning against a REAL PostgreSQL server —
 * not just that the SQL text looks plausible. Requires a reachable local Postgres
 * superuser at 127.0.0.1:5432 (same as this package's other integration test — see
 * README's "Try it today"). Everything this test creates (one throwaway database) is
 * dropped in `afterAll`. Run via `pnpm --filter @aiappfactory/spec-compiler
 * test:integration`.
 */

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? "hayato";
const TEST_DB = `aiaf_spec_compiler_archive_test_${Date.now()}`;
const APP_ROLE_PASSWORD = "test-only-not-a-real-secret";

const templatesDir = join(import.meta.dirname, "..", "..", "..", "..", "templates");

let adminPool: pg.Pool;
let schemaName: string;
let roleName: string;

beforeAll(async () => {
  const bootstrapPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await bootstrapPool.query(`CREATE DATABASE ${quoteIdent(TEST_DB)}`);
  await bootstrapPool.end();

  adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: TEST_DB });
  await applyPlatformBootstrap(adminPool);

  const source = readFileSync(join(templatesDir, "it-equipment-request", "app.yaml"), "utf-8");
  const parsed = parseAppSpecYaml(source);
  if (!parsed.ok) throw new Error(`template failed to validate: ${JSON.stringify(parsed.issues)}`);
  // Unique id per run — see rls.pg.test.ts's identical comment (ADR-007: roles are cluster-wide).
  const spec = { ...parsed.spec, metadata: { ...parsed.spec.metadata, id: `it-equipment-request-archive-test-${Date.now()}` } };

  const migration = compileAppSpec(spec, { rolePassword: APP_ROLE_PASSWORD });
  schemaName = migration.schemaName;
  roleName = migration.roleName;
  await applyMigration(adminPool, migration);
}, 30_000);

afterAll(async () => {
  // Best-effort: if a test below already archived everything, there's nothing left
  // to clean up here — the DROP DATABASE covers whatever (if anything) remains.
  if (adminPool) await adminPool.end();
  const cleanupPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await cleanupPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(TEST_DB)} WITH (FORCE)`).catch(() => {});
  await cleanupPool.query(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`).catch(() => {});
  await cleanupPool.end();
}, 30_000);

async function schemaExists(pool: pg.Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [name]);
  return rows.length > 0;
}

async function roleExists(pool: pg.Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
  return rows.length > 0;
}

describe("archiveApp against a real Postgres server", () => {
  it("the schema and role exist before archiving (sanity check on the fixture)", async () => {
    expect(await schemaExists(adminPool, schemaName)).toBe(true);
    expect(await roleExists(adminPool, roleName)).toBe(true);
  });

  it("archives the app: drops the schema (and everything in it) and the role", async () => {
    const result = await archiveApp(adminPool, schemaName, roleName);
    expect(result).toEqual({ schemaDropped: true, roleDropped: true });
    expect(await schemaExists(adminPool, schemaName)).toBe(false);
    expect(await roleExists(adminPool, roleName)).toBe(false);
  });

  it("is idempotent: archiving an already-archived (or never-provisioned) app is a no-op, not an error", async () => {
    await expect(archiveApp(adminPool, schemaName, roleName)).resolves.toEqual({ schemaDropped: false, roleDropped: false });
    await expect(archiveApp(adminPool, "app_never_existed", "app_never_existed_rw")).resolves.toEqual({
      schemaDropped: false,
      roleDropped: false,
    });
  });
});
