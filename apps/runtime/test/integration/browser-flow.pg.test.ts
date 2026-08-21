import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppSpecYaml, type AppSpec } from "@aiappfactory/app-spec";
import { quoteIdent } from "@aiappfactory/expr";
import { AppRegistry, buildServer as buildGatewayServer } from "@aiappfactory/sdk-gateway";
import { applyMigration, applyPlatformBootstrap, compileAppSpec } from "@aiappfactory/spec-compiler";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RuntimeAppRegistry } from "../../src/appRegistry.js";
import { DevUserDirectory } from "../../src/devUsers.js";
import { buildRuntimeServer } from "../../src/server.js";

/**
 * End-to-end proof of M1's Walking Skeleton DoD (ROADMAP.md): a hand-written Spec
 * becomes a browser-reachable app — register a record via an HTML form, see it in a
 * list, search it, and have RLS-based row visibility hold even through the
 * server-rendered HTML layer, not just the JSON API. Also proves ADR-012's per-app
 * origin routing: two DIFFERENT apps, served by the SAME Runtime process, are
 * distinguished entirely by which hostname a request arrived on — never a path
 * segment — and an unregistered hostname is refused before auth is even attempted.
 *
 * `*.localhost` hostnames resolve to loopback automatically on most systems/browsers
 * (RFC 6761) — no `/etc/hosts` edit needed, which is why the Runtime is bound to `::`
 * here instead of a bare `127.0.0.1`. Run via `pnpm test:integration`.
 */

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? "hayato";
const TEST_DB = `aiaf_runtime_test_${Date.now()}`;
const APP_ROLE_PASSWORD = "test-only-not-a-real-secret";

const templatesDir = join(import.meta.dirname, "..", "..", "..", "..", "templates");

const HOST_A = "app-a.apps.localhost";
const HOST_B = "app-b.apps.localhost";

let adminPool: pg.Pool;
let poolA: pg.Pool;
let poolB: pg.Pool;
let gatewayServer: FastifyInstance;
let runtimeServer: FastifyInstance;
let runtimePort: number;
let roleNameA: string;
let roleNameB: string;
let appIdA: string;

let deptSales: string;
let alice: string;
let bob: string;

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function urlFor(hostname: string, path: string): string {
  return `http://${hostname}:${runtimePort}${path}`;
}

async function loadUniqueSpec(templateDir: string): Promise<AppSpec> {
  const source = readFileSync(join(templatesDir, templateDir, "app.yaml"), "utf-8");
  const parsed = parseAppSpecYaml(source);
  if (!parsed.ok) throw new Error(`template failed to validate: ${JSON.stringify(parsed.issues)}`);
  // Unique per run — roles are CLUSTER-wide in Postgres, not per-database, so reusing
  // the template's literal id would collide with e.g. `pnpm dev:sample`'s persistent role.
  return { ...parsed.spec, metadata: { ...parsed.spec.metadata, id: `${parsed.spec.metadata.id}-test-${Date.now()}` } };
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

  const specA = await loadUniqueSpec("sales-daily-report");
  const specB = await loadUniqueSpec("expense-request");
  appIdA = specA.metadata.id;

  const migrationA = compileAppSpec(specA, { rolePassword: APP_ROLE_PASSWORD });
  const migrationB = compileAppSpec(specB, { rolePassword: APP_ROLE_PASSWORD });
  roleNameA = migrationA.roleName;
  roleNameB = migrationB.roleName;
  await applyMigration(adminPool, migrationA);
  await applyMigration(adminPool, migrationB);

  poolA = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleNameA, password: APP_ROLE_PASSWORD, database: TEST_DB });
  poolB = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleNameB, password: APP_ROLE_PASSWORD, database: TEST_DB });

  const gatewayRegistry = new AppRegistry();
  gatewayRegistry.register(specA.metadata.id, { spec: specA, pool: poolA, schemaName: migrationA.schemaName });
  gatewayRegistry.register(specB.metadata.id, { spec: specB, pool: poolB, schemaName: migrationB.schemaName });

  gatewayServer = buildGatewayServer(gatewayRegistry);
  await gatewayServer.listen({ port: 0, host: "127.0.0.1" });
  const gatewayAddress = gatewayServer.server.address() as AddressInfo;
  const gatewayUrl = `http://127.0.0.1:${gatewayAddress.port}`;

  const users = new DevUserDirectory();
  users.add("alice", { password: "alice-pw", ctx: { userId: alice, department: deptSales, roles: ["sales_member"] } });
  users.add("bob", { password: "bob-pw", ctx: { userId: bob, department: deptSales, roles: ["sales_member"] } });

  const runtimeRegistry = new RuntimeAppRegistry();
  runtimeRegistry.register(HOST_A, { appId: specA.metadata.id, spec: specA, gatewayUrl });
  runtimeRegistry.register(HOST_B, { appId: specB.metadata.id, spec: specB, gatewayUrl });

  runtimeServer = buildRuntimeServer({ registry: runtimeRegistry, users });
  await runtimeServer.listen({ port: 0, host: "::" });
  const runtimeAddress = runtimeServer.server.address() as AddressInfo;
  runtimePort = runtimeAddress.port;
}, 30_000);

afterAll(async () => {
  await runtimeServer?.close();
  await gatewayServer?.close();
  await poolA?.end();
  await poolB?.end();
  if (adminPool) {
    for (const role of [roleNameA, roleNameB]) {
      if (!role) continue;
      await adminPool.query(`DROP OWNED BY ${quoteIdent(role)}`).catch(() => {});
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`).catch(() => {});
    }
    await adminPool.end();
  }
  const cleanupPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await cleanupPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(TEST_DB)} WITH (FORCE)`).catch(() => {});
  await cleanupPool.end();
}, 30_000);

describe("browser-facing flow: register → list → search, RLS-enforced", () => {
  it("rejects requests without credentials", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"));
    expect(res.status).toBe(401);
  });

  it("GET the form page renders an HTML form with the entity's fields", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain('name="customerName"');
    expect(html).not.toContain('name="author"'); // actor field never rendered
  });

  it("POSTing the form creates a record and redirects to the list page", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"), {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: basicAuthHeader("alice", "alice-pw"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ reportDate: "2026-08-21", customerName: "Acme Corp", amount: "500", body: "初回商談" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/pages/1`);
  });

  it("the date renders exactly as entered — no server-local-timezone shift (pgTypes.ts regression guard)", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/1"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const html = await res.text();
    expect(html).toContain("2026-08-21");
    expect(html).not.toContain("2026-08-20"); // the exact off-by-one this test guards against
  });

  it("alice's list page shows her new record", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/1"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const html = await res.text();
    expect(html).toContain("Acme Corp");
  });

  it("bob (different sales_member, read:own) does NOT see alice's record in the list", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/1"), { headers: { authorization: basicAuthHeader("bob", "bob-pw") } });
    const html = await res.text();
    expect(html).not.toContain("Acme Corp");
    expect(html).toContain("データがありません");
  });

  it("the search box filters the list by the declared search field", async () => {
    const hit = await fetch(urlFor(HOST_A, "/pages/1?q=acme"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(await hit.text()).toContain("Acme Corp");

    const miss = await fetch(urlFor(HOST_A, "/pages/1?q=nonexistent"), {
      headers: { authorization: basicAuthHeader("alice", "alice-pw") },
    });
    expect(await miss.text()).not.toContain("Acme Corp");
  });

  it("the JSON API surface works too, under the same auth", async () => {
    const res = await fetch(urlFor(HOST_A, "/api/DailyReport"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: Array<{ customerName: string }> };
    expect(json.ok).toBe(true);
    expect(json.rows.some((r) => r.customerName === "Acme Corp")).toBe(true);
  });
});

describe("per-app origin routing (ADR-012, S-15)", () => {
  it("the SAME path on two different hosts serves two DIFFERENT apps", async () => {
    const resA = await fetch(urlFor(HOST_A, "/pages/0"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const resB = await fetch(urlFor(HOST_B, "/pages/0"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    const htmlA = await resA.text();
    const htmlB = await resB.text();
    expect(htmlA).toContain("日報を書く"); // sales-daily-report's form title
    expect(htmlB).toContain("経費を申請する"); // expense-request's form title
    expect(htmlA).not.toContain("経費を申請する");
    expect(htmlB).not.toContain("日報を書く");
  });

  it("an unregistered host is refused with 404 BEFORE credentials are even checked", async () => {
    const withoutAuth = await fetch(urlFor("ghost.apps.localhost", "/pages/0"));
    expect(withoutAuth.status).toBe(404);
    expect(withoutAuth.headers.get("www-authenticate")).toBeNull(); // never got as far as an auth challenge

    const withAuth = await fetch(urlFor("ghost.apps.localhost", "/pages/0"), {
      headers: { authorization: basicAuthHeader("alice", "alice-pw") },
    });
    expect(withAuth.status).toBe(404);
  });

  it("every response carries the origin-isolation headers (X-Frame-Options, COOP, CORP, CSP)", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"), { headers: { authorization: basicAuthHeader("alice", "alice-pw") } });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("/healthz reports the resolved app id for a known host and 404s for an unknown one, with no auth required either way", async () => {
    const known = await fetch(urlFor(HOST_A, "/healthz"));
    expect(known.status).toBe(200);
    expect((await known.json()) as { appId: string }).toMatchObject({ ok: true, appId: appIdA });

    const unknown = await fetch(urlFor("ghost.apps.localhost", "/healthz"));
    expect(unknown.status).toBe(404);
  });
});
