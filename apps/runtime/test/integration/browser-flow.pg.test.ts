import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { parseAppSpecYaml, type AppSpec } from "@aiappfactory/app-spec";
import { createOidcAuth, type OidcAuth } from "@aiappfactory/auth-bff";
import { quoteIdent } from "@aiappfactory/expr";
import {
  KeycloakAdminClient,
  addClaimsMappers,
  allowUnmanagedAttributes,
  createConfidentialClient,
  createRealm,
  createRealmRole,
  createUser,
} from "@aiappfactory/keycloak-admin";
import { AppRegistry, buildServer as buildGatewayServer } from "@aiappfactory/sdk-gateway";
import { applyMigration, applyPlatformBootstrap, compileAppSpec } from "@aiappfactory/spec-compiler";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RuntimeAppRegistry } from "../../src/appRegistry.js";
import { buildRuntimeServer } from "../../src/server.js";

/**
 * End-to-end proof of M1's Walking Skeleton DoD PLUS M4's real-auth slice: a
 * hand-written Spec becomes a browser-reachable app, gated by an actual Keycloak
 * login (ADR-006 Authorization Code + PKCE, BFF pattern) rather than the retired
 * DevUserDirectory placeholder — register a record via an HTML form, see it in a
 * list, search it, and have RLS-based row visibility hold, all behind a real OIDC
 * login form. Also proves ADR-012's per-app origin routing holds with TWO
 * independent OIDC clients (one per app, as ADR-006 requires) served by the SAME
 * Runtime process: a session minted by one app's login is meaningless to the other.
 *
 * Needs both a local Postgres superuser (see the other suites' header comments) AND
 * Docker (for a throwaway Keycloak container — see packages/auth-bff's integration
 * suite). Run via `pnpm test:integration`.
 */

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? "hayato";
const TEST_DB = `aiaf_runtime_test_${Date.now()}`;
const APP_ROLE_PASSWORD = "test-only-not-a-real-secret";

const KC_CONTAINER = `aiaf-kc-runtime-test-${Date.now()}`;
const KC_PORT = 19080 + Math.floor(Math.random() * 1000);
const KC_BASE_URL = `http://localhost:${KC_PORT}`;
const REALM = "factory-test";

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
let appIdB: string;
let deptSales: string;
let alice: { id: string };
let bob: { id: string };

function removeContainerIfExists(): void {
  try {
    execFileSync("docker", ["rm", "-f", KC_CONTAINER], { stdio: "ignore" });
  } catch {
    // fine
  }
}

async function waitForKeycloak(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${KC_BASE_URL}/realms/master`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Keycloak did not become ready in time");
}

function urlFor(hostname: string, path: string): string {
  return `http://${hostname}:${runtimePort}${path}`;
}

async function loadUniqueSpec(templateDir: string): Promise<AppSpec> {
  const source = readFileSync(join(templatesDir, templateDir, "app.yaml"), "utf-8");
  const parsed = parseAppSpecYaml(source);
  if (!parsed.ok) throw new Error(`template failed to validate: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, metadata: { ...parsed.spec.metadata, id: `${parsed.spec.metadata.id}-test-${Date.now()}` } };
}

async function provisionOidcClient(
  admin: KeycloakAdminClient,
  clientId: string,
  redirectUri: string
): Promise<OidcAuth> {
  const clientUuid = await createConfidentialClient(admin, REALM, {
    clientId,
    secret: `${clientId}-secret`,
    redirectUris: [redirectUri],
  });
  await addClaimsMappers(admin, REALM, clientUuid);
  return createOidcAuth({
    issuerUrl: `${KC_BASE_URL}/realms/${REALM}`,
    clientId,
    clientSecret: `${clientId}-secret`,
    redirectUri,
  });
}

beforeAll(async () => {
  // --- Postgres: schema/role for both apps ---
  const bootstrapPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  await bootstrapPool.query(`CREATE DATABASE ${quoteIdent(TEST_DB)}`);
  await bootstrapPool.end();
  adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: TEST_DB });
  await applyPlatformBootstrap(adminPool);

  // --- Keycloak: realm + roles + users (their Keycloak-generated UUIDs become public.users.id) ---
  removeContainerIfExists();
  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    KC_CONTAINER,
    "-p",
    `${KC_PORT}:8080`,
    "-e",
    "KC_BOOTSTRAP_ADMIN_USERNAME=admin",
    "-e",
    "KC_BOOTSTRAP_ADMIN_PASSWORD=admin",
    "quay.io/keycloak/keycloak:26.0",
    "start-dev",
  ]);
  await waitForKeycloak();

  const kcAdmin = await KeycloakAdminClient.authenticate({ baseUrl: KC_BASE_URL, adminUsername: "admin", adminPassword: "admin" });
  await createRealm(kcAdmin, REALM);
  await allowUnmanagedAttributes(kcAdmin, REALM);
  await createRealmRole(kcAdmin, REALM, "sales_member");

  deptSales = "00000000-0000-0000-0000-0000000000d1";
  const aliceId = await createUser(kcAdmin, REALM, {
    username: "alice",
    password: "alice-pw",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Sales",
    department: deptSales,
    roles: ["sales_member"],
  });
  const bobId = await createUser(kcAdmin, REALM, {
    username: "bob",
    password: "bob-pw",
    email: "bob@example.com",
    firstName: "Bob",
    lastName: "Sales",
    department: deptSales,
    roles: ["sales_member"],
  });
  alice = { id: aliceId };
  bob = { id: bobId };

  await adminPool.query(`INSERT INTO public.departments (id) VALUES ($1)`, [deptSales]);
  await adminPool.query(`INSERT INTO public.users (id, department_id) VALUES ($1, $2), ($3, $2)`, [alice.id, deptSales, bob.id]);

  // --- Specs A/B, each with their own DB schema/role and their own OIDC client ---
  const specA = await loadUniqueSpec("sales-daily-report");
  const specB = await loadUniqueSpec("expense-request"); // roles differ (employee/finance_approver) — unused by these tests, just proves two unrelated Specs coexist
  appIdA = specA.metadata.id;
  appIdB = specB.metadata.id;

  const migrationA = compileAppSpec(specA, { rolePassword: APP_ROLE_PASSWORD });
  const migrationB = compileAppSpec(specB, { rolePassword: APP_ROLE_PASSWORD });
  roleNameA = migrationA.roleName;
  roleNameB = migrationB.roleName;
  await applyMigration(adminPool, migrationA);
  await applyMigration(adminPool, migrationB);

  poolA = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleNameA, password: APP_ROLE_PASSWORD, database: TEST_DB });
  poolB = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleNameB, password: APP_ROLE_PASSWORD, database: TEST_DB });

  const gatewayRegistry = new AppRegistry();
  gatewayRegistry.register(appIdA, { spec: specA, pool: poolA, schemaName: migrationA.schemaName });
  gatewayRegistry.register(appIdB, { spec: specB, pool: poolB, schemaName: migrationB.schemaName });

  gatewayServer = buildGatewayServer(gatewayRegistry);
  await gatewayServer.listen({ port: 0, host: "127.0.0.1" });
  const gatewayUrl = `http://127.0.0.1:${(gatewayServer.server.address() as AddressInfo).port}`;

  // Runtime port must be known before provisioning OIDC clients (redirect_uri must match exactly).
  runtimePort = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });

  const oidcA = await provisionOidcClient(kcAdmin, "test-runtime-a", urlFor(HOST_A, "/auth/callback"));
  const oidcB = await provisionOidcClient(kcAdmin, "test-runtime-b", urlFor(HOST_B, "/auth/callback"));

  const runtimeRegistry = new RuntimeAppRegistry();
  runtimeRegistry.register(HOST_A, { appId: appIdA, spec: specA, gatewayUrl, oidcAuth: oidcA });
  runtimeRegistry.register(HOST_B, { appId: appIdB, spec: specB, gatewayUrl, oidcAuth: oidcB });

  runtimeServer = buildRuntimeServer({ registry: runtimeRegistry });
  await runtimeServer.listen({ port: runtimePort, host: "::" });
}, 180_000);

afterAll(async () => {
  await runtimeServer?.close();
  await gatewayServer?.close();
  await poolA?.end();
  await poolB?.end();
  removeContainerIfExists();
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

/** Simulates a browser: follow the login redirect, submit Keycloak's real login form, follow the callback. Returns this Runtime's session Set-Cookie value. */
async function loginAsUser(hostname: string, username: string, password: string, returnTo: string): Promise<string> {
  const loginRedirect = await fetch(urlFor(hostname, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`), { redirect: "manual" });
  const authorizeUrl = loginRedirect.headers.get("location");
  if (!authorizeUrl) throw new Error(`no Location header from ${hostname}/auth/login (status ${loginRedirect.status})`);

  const loginPage = await fetch(authorizeUrl, { redirect: "manual" });
  const kcCookies = loginPage.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const html = await loginPage.text();
  const formAction = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!formAction) throw new Error(`no login form on Keycloak's page:\n${html}`);

  const submitLogin = await fetch(formAction, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: kcCookies },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  const callbackUrl = submitLogin.headers.get("location");
  if (!callbackUrl) throw new Error(`Keycloak rejected "${username}"/"${password}"`);

  const callback = await fetch(callbackUrl, { redirect: "manual" });
  if (callback.status !== 302) {
    throw new Error(`callback failed (${callback.status}): ${await callback.text()}`);
  }
  expect(callback.headers.get("location")).toBe(returnTo);
  const sessionCookie = callback.headers.getSetCookie()[0];
  if (!sessionCookie) throw new Error(`${hostname}/auth/callback set no session cookie`);
  return sessionCookie.split(";")[0]!;
}

describe("browser-facing flow, gated by a real Keycloak login: register → list → search, RLS-enforced", () => {
  it("an unauthenticated request to a page is redirected to /auth/login, not shown a Basic Auth prompt", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/login\?returnTo=/);
  });

  it("an unauthenticated API request gets 401 JSON, not a redirect (fetch/XHR can't follow a login redirect usefully)", async () => {
    const res = await fetch(urlFor(HOST_A, "/api/DailyReport"));
    expect(res.status).toBe(401);
  });

  it("logging in as alice through Keycloak's real login form, then filling in and submitting the HTML form, creates a record", async () => {
    const sessionCookie = await loginAsUser(HOST_A, "alice", "alice-pw", "/pages/0");
    const formPage = await fetch(urlFor(HOST_A, "/pages/0"), { headers: { cookie: sessionCookie } });
    expect(formPage.status).toBe(200);
    expect(await formPage.text()).toContain('name="customerName"');

    const submit = await fetch(urlFor(HOST_A, "/pages/0"), {
      method: "POST",
      redirect: "manual",
      headers: { cookie: sessionCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reportDate: "2026-08-21", customerName: "Acme Corp", amount: "500", body: "初回商談" }),
    });
    expect(submit.status).toBe(302);
    expect(submit.headers.get("location")).toBe("/pages/1");

    const list = await fetch(urlFor(HOST_A, "/pages/1"), { headers: { cookie: sessionCookie } });
    expect(await list.text()).toContain("Acme Corp");
  });

  it("bob (different sales_member, read:own) does not see alice's record", async () => {
    const bobCookie = await loginAsUser(HOST_A, "bob", "bob-pw", "/pages/1");
    const list = await fetch(urlFor(HOST_A, "/pages/1"), { headers: { cookie: bobCookie } });
    expect(await list.text()).not.toContain("Acme Corp");
  });
});

describe("per-app origin routing with independent OIDC clients (ADR-006, ADR-012)", () => {
  it("app A and app B are genuinely different OIDC clients — logging into each is independent", async () => {
    const cookieA = await loginAsUser(HOST_A, "alice", "alice-pw", "/pages/0");
    const cookieB = await loginAsUser(HOST_B, "alice", "alice-pw", "/pages/0");
    expect(cookieA).not.toBe(cookieB);

    const pageA = await fetch(urlFor(HOST_A, "/pages/0"), { headers: { cookie: cookieA } });
    const pageB = await fetch(urlFor(HOST_B, "/pages/0"), { headers: { cookie: cookieB } });
    expect(await pageA.text()).toContain("日報を書く");
    expect(await pageB.text()).toContain("経費を申請する");
  });

  it("a session cookie minted by app A's login is meaningless on app B (separate SessionStore per OidcAuth)", async () => {
    const cookieA = await loginAsUser(HOST_A, "alice", "alice-pw", "/pages/0");
    const res = await fetch(urlFor(HOST_B, "/pages/0"), { headers: { cookie: cookieA }, redirect: "manual" });
    expect(res.status).toBe(302); // treated as unauthenticated, redirected to app B's own /auth/login
    expect(res.headers.get("location")).toMatch(/^\/auth\/login/);
  });

  it("an unregistered host is refused with 404 before any auth redirect", async () => {
    const res = await fetch(urlFor("ghost.apps.localhost", "/pages/0"), { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("every response carries the origin-isolation headers", async () => {
    const res = await fetch(urlFor(HOST_A, "/pages/0"), { redirect: "manual" });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("/healthz needs no auth and reports the resolved app id", async () => {
    const res = await fetch(urlFor(HOST_A, "/healthz"));
    expect(res.status).toBe(200);
    expect((await res.json()) as { appId: string }).toMatchObject({ ok: true, appId: appIdA });
  });
});
