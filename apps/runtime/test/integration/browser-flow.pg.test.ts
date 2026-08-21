import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { quoteIdent } from "@aiappfactory/expr";
import { AppRegistry, buildServer as buildGatewayServer } from "@aiappfactory/sdk-gateway";
import { applyMigration, applyPlatformBootstrap, compileAppSpec } from "@aiappfactory/spec-compiler";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DevUserDirectory } from "../../src/devUsers.js";
import { buildRuntimeServer } from "../../src/server.js";

/**
 * End-to-end proof of M1's Walking Skeleton DoD (ROADMAP.md): a hand-written Spec
 * becomes a browser-reachable app — register a record via an HTML form, see it in a
 * list, search it, and have RLS-based row visibility hold even through the
 * server-rendered HTML layer, not just the JSON API. Drives real HTTP requests
 * (fetch) against a live apps/runtime server backed by a live sdk-gateway server
 * backed by a real Postgres — the same infra pattern as the other two integration
 * suites. Run via `pnpm test:integration`.
 */

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? "hayato";
const TEST_DB = `aiaf_runtime_test_${Date.now()}`;
const APP_ROLE_PASSWORD = "test-only-not-a-real-secret";

const templatesDir = join(import.meta.dirname, "..", "..", "..", "..", "templates");

let adminPool: pg.Pool;
let appRolePool: pg.Pool;
let gatewayServer: FastifyInstance;
let runtimeServer: FastifyInstance;
let runtimeUrl: string;
let roleName: string;
let appId: string;

let deptSales: string;
let alice: string;
let bob: string;

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

beforeAll(async () => {
  const bootstrapPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await bootstrapPool.query(`CREATE DATABASE ${quoteIdent(TEST_DB)}`);
  await bootstrapPool.end();

  adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: TEST_DB });
  await applyPlatformBootstrap(adminPool);

  deptSales = randomUUID();
  alice = randomUUID();
  bob = randomUUID();
  await adminPool.query(`INSERT INTO public.departments (id) VALUES ($1)`, [deptSales]);
  await adminPool.query(`INSERT INTO public.users (id, department_id) VALUES ($1, $2), ($3, $2)`, [alice, deptSales, bob]);

  const source = readFileSync(join(templatesDir, "sales-daily-report", "app.yaml"), "utf-8");
  const parsed = parseAppSpecYaml(source);
  if (!parsed.ok) throw new Error(`template failed to validate: ${JSON.stringify(parsed.issues)}`);
  // Unique per run — roles are CLUSTER-wide in Postgres, not per-database, so reusing
  // the template's literal id would collide with e.g. `pnpm dev:sample`'s persistent role.
  const spec = { ...parsed.spec, metadata: { ...parsed.spec.metadata, id: `sales-daily-report-test-${Date.now()}` } };
  appId = spec.metadata.id;

  const migration = compileAppSpec(spec, { rolePassword: APP_ROLE_PASSWORD });
  roleName = migration.roleName;
  await applyMigration(adminPool, migration);

  appRolePool = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleName, password: APP_ROLE_PASSWORD, database: TEST_DB });
  const registry = new AppRegistry();
  registry.register(appId, { spec, pool: appRolePool, schemaName: migration.schemaName });

  gatewayServer = buildGatewayServer(registry);
  await gatewayServer.listen({ port: 0, host: "127.0.0.1" });
  const gatewayAddress = gatewayServer.server.address() as AddressInfo;
  const gatewayUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  const users = new DevUserDirectory();
  users.add("alice", { password: "alice-pw", ctx: { userId: alice, department: deptSales, roles: ["sales_member"] } });
  users.add("bob", { password: "bob-pw", ctx: { userId: bob, department: deptSales, roles: ["sales_member"] } });

  runtimeServer = buildRuntimeServer({ spec, gatewayUrl, users });
  await runtimeServer.listen({ port: 0, host: "127.0.0.1" });
  const runtimeAddress = runtimeServer.server.address() as AddressInfo;
  runtimeUrl = `http://127.0.0.1:${runtimeAddress.port}`;
}, 30_000);

afterAll(async () => {
  await runtimeServer?.close();
  await gatewayServer?.close();
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

describe("browser-facing flow: register → list → search, RLS-enforced", () => {
  it("rejects requests without credentials", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/0`);
    expect(res.status).toBe(401);
  });

  it("GET the form page renders an HTML form with the entity's fields", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/0`, { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain('name="customerName"');
    expect(html).not.toContain('name="author"'); // actor field never rendered
  });

  it("POSTing the form creates a record and redirects to the list page", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/0`, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: basicAuthHeader("alice", "alice-pw"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ reportDate: "2026-08-21", customerName: "Acme Corp", amount: "500", body: "初回商談" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/apps/${appId}/pages/1`);
  });

  it("the date renders exactly as entered — no server-local-timezone shift (pgTypes.ts regression guard)", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/1`, { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const html = await res.text();
    expect(html).toContain("2026-08-21");
    expect(html).not.toContain("2026-08-20"); // the exact off-by-one this test guards against
  });

  it("alice's list page shows her new record", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/1`, { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const html = await res.text();
    expect(html).toContain("Acme Corp");
  });

  it("bob (different sales_member, read:own) does NOT see alice's record in the list", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/pages/1`, { headers: { authorization: basicAuthHeader("bob", "bob-pw") } });
    const html = await res.text();
    expect(html).not.toContain("Acme Corp");
    expect(html).toContain("データがありません");
  });

  it("the search box filters the list by the declared search field", async () => {
    const hit = await fetch(`${runtimeUrl}/apps/${appId}/pages/1?q=acme`, { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(await hit.text()).toContain("Acme Corp");

    const miss = await fetch(`${runtimeUrl}/apps/${appId}/pages/1?q=nonexistent`, {
      headers: { authorization: basicAuthHeader("alice", "alice-pw") },
    });
    expect(await miss.text()).not.toContain("Acme Corp");
  });

  it("the JSON API surface works too, under the same auth", async () => {
    const res = await fetch(`${runtimeUrl}/apps/${appId}/api/DailyReport`, { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: Array<{ customerName: string }> };
    expect(json.ok).toBe(true);
    expect(json.rows.some((r) => r.customerName === "Acme Corp")).toBe(true);
  });
});
