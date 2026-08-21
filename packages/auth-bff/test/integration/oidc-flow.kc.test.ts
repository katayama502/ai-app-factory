import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import {
  KeycloakAdminClient,
  addClaimsMappers,
  allowUnmanagedAttributes,
  createConfidentialClient,
  createRealm,
  createRealmRole,
  createUser,
} from "@aiappfactory/keycloak-admin";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExpiredCookie, buildSessionCookie, parseCookieHeader, sessionCookieName } from "../../src/cookies.js";
import { OidcCallbackError, createOidcAuth, type OidcAuth } from "../../src/oidcAuth.js";

/**
 * Proves the Authorization Code + PKCE flow (ADR-006) works against a REAL Keycloak,
 * not a mock — including the parts that only fail against a real instance (declarative
 * User Profile silently dropping custom attributes, the realm-roles mapper defaulting
 * to `id.token.claim=false`, "Account is not fully set up" from an incomplete profile
 * — see packages/keycloak-admin's doc comments for how each was found and fixed).
 *
 * Spins up its own throwaway `quay.io/keycloak/keycloak` container via Docker (unlike
 * the Postgres-backed suites, which assume a persistent local server — Keycloak isn't
 * something this repo expects to already be running). Simulates a browser by hand:
 * follow the redirect to Keycloak's hosted login page, parse+submit its login form,
 * follow the redirect back. Run via `pnpm test:integration` — requires Docker.
 */

const KC_CONTAINER = `aiaf-kc-authbff-test-${Date.now()}`;
const KC_PORT = 18080 + Math.floor(Math.random() * 1000);
const KC_BASE_URL = `http://localhost:${KC_PORT}`;
const REALM = "factory-test";

let runtimePort: number;
let runtimeUrl: string;
let runtimeApp: FastifyInstance;
let oidcAuth: OidcAuth;

function removeContainerIfExists(): void {
  try {
    execFileSync("docker", ["rm", "-f", KC_CONTAINER], { stdio: "ignore" });
  } catch {
    // fine — container didn't exist
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

async function waitForKeycloak(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${KC_BASE_URL}/realms/master`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Keycloak did not become ready in time");
}

beforeAll(async () => {
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

  runtimePort = await getFreePort();
  runtimeUrl = `http://localhost:${runtimePort}`;

  const admin = await KeycloakAdminClient.authenticate({ baseUrl: KC_BASE_URL, adminUsername: "admin", adminPassword: "admin" });
  await createRealm(admin, REALM);
  await allowUnmanagedAttributes(admin, REALM);
  const clientUuid = await createConfidentialClient(admin, REALM, {
    clientId: "test-bff",
    secret: "test-bff-secret",
    redirectUris: [`${runtimeUrl}/auth/callback`],
  });
  await addClaimsMappers(admin, REALM, clientUuid);
  await createRealmRole(admin, REALM, "sales_member");
  await createUser(admin, REALM, {
    username: "alice",
    password: "alice-pw",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Sales",
    department: "dept-uuid-123",
    roles: ["sales_member"],
  });

  oidcAuth = await createOidcAuth({
    issuerUrl: `${KC_BASE_URL}/realms/${REALM}`,
    clientId: "test-bff",
    clientSecret: "test-bff-secret",
    redirectUri: `${runtimeUrl}/auth/callback`,
  });

  // Mirrors exactly how apps/runtime/src/server.ts wires this: createOidcAuth() only
  // builds the OIDC logic, never registers routes itself (a real Runtime hosts many
  // apps behind ONE set of /auth/* paths, dispatching by Host — see oidcAuth.ts).
  runtimeApp = Fastify({ logger: false });

  runtimeApp.get<{ Querystring: { returnTo?: string } }>("/auth/login", async (request, reply) => {
    const url = await oidcAuth.startLogin(request.query.returnTo ?? "/");
    reply.redirect(url.href);
  });

  runtimeApp.get("/auth/callback", async (request, reply) => {
    try {
      const { claims, returnTo } = await oidcAuth.completeLogin(new URL(request.url, runtimeUrl));
      const sid = oidcAuth.createSession(claims);
      reply.header("set-cookie", buildSessionCookie(sessionCookieName(false), sid, false, 3600));
      reply.redirect(returnTo);
    } catch (error) {
      if (error instanceof OidcCallbackError) {
        reply.code(400).send({ ok: false, error: error.message });
        return;
      }
      throw error;
    }
  });

  runtimeApp.get("/auth/logout", async (request, reply) => {
    const sid = parseCookieHeader(request.headers.cookie)[sessionCookieName(false)];
    oidcAuth.destroySession(sid);
    reply.header("set-cookie", buildExpiredCookie(sessionCookieName(false), false));
    reply.redirect("/");
  });

  runtimeApp.get("/whoami", async (request, reply) => {
    const sid = parseCookieHeader(request.headers.cookie)[sessionCookieName(false)];
    const claims = oidcAuth.resolveSession(sid);
    if (!claims) return reply.code(401).send({ ok: false });
    reply.send({ ok: true, claims });
  });

  await runtimeApp.listen({ port: runtimePort, host: "127.0.0.1" });
}, 120_000);

afterAll(async () => {
  await runtimeApp?.close();
  removeContainerIfExists();
}, 30_000);

/** Simulates a browser walking the full Authorization Code + PKCE dance, including actually filling in and submitting Keycloak's own login form. Returns the session Set-Cookie value this BFF issued. */
async function loginAsUser(username: string, password: string, returnTo: string): Promise<string> {
  const loginRedirect = await fetch(`${runtimeUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: "manual" });
  expect(loginRedirect.status).toBe(302);
  const authorizeUrl = loginRedirect.headers.get("location");
  if (!authorizeUrl) throw new Error("no Location header from /auth/login");

  const loginPage = await fetch(authorizeUrl, { redirect: "manual" });
  const kcCookies = loginPage.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const html = await loginPage.text();
  const actionMatch = html.match(/action="([^"]+)"/);
  if (!actionMatch) throw new Error(`no <form action> found in Keycloak's login page:\n${html}`);
  const formAction = actionMatch[1]!.replace(/&amp;/g, "&");

  const submitLogin = await fetch(formAction, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: kcCookies },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  const callbackUrl = submitLogin.headers.get("location");
  if (!callbackUrl) throw new Error(`Keycloak login did not redirect back — is "${username}"/"${password}" correct?`);

  const callback = await fetch(callbackUrl, { redirect: "manual" });
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(returnTo);
  const sessionCookie = callback.headers.getSetCookie()[0];
  if (!sessionCookie) throw new Error("no session cookie set by /auth/callback");
  return sessionCookie.split(";")[0]!;
}

describe("OIDC Authorization Code + PKCE against a real Keycloak", () => {
  it("an unauthenticated request to a protected route is rejected", async () => {
    const res = await fetch(`${runtimeUrl}/whoami`);
    expect(res.status).toBe(401);
  });

  it("logging in as alice through Keycloak's real login form yields a session with her department and roles", async () => {
    const sessionCookie = await loginAsUser("alice", "alice-pw", "/whoami");
    const res = await fetch(`${runtimeUrl}/whoami`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; claims: { userId: string; department: string; roles: string[] } };
    expect(body.claims.department).toBe("dept-uuid-123");
    expect(body.claims.roles).toContain("sales_member");
  });

  it("logging in with the wrong password never reaches our callback (Keycloak itself rejects it)", async () => {
    await expect(loginAsUser("alice", "wrong-password", "/whoami")).rejects.toThrow(/did not redirect back/);
  });

  it("replaying a callback URL a second time fails — state is one-shot (CSRF/replay protection)", async () => {
    const loginRedirect = await fetch(`${runtimeUrl}/auth/login?returnTo=/whoami`, { redirect: "manual" });
    const authorizeUrl = loginRedirect.headers.get("location")!;
    const loginPage = await fetch(authorizeUrl, { redirect: "manual" });
    const kcCookies = loginPage.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const html = await loginPage.text();
    const formAction = html.match(/action="([^"]+)"/)![1]!.replace(/&amp;/g, "&");
    const submitLogin = await fetch(formAction, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: kcCookies },
      body: new URLSearchParams({ username: "alice", password: "alice-pw", credentialId: "" }),
    });
    const callbackUrl = submitLogin.headers.get("location")!;

    const first = await fetch(callbackUrl, { redirect: "manual" });
    expect(first.status).toBe(302);

    const second = await fetch(callbackUrl, { redirect: "manual" });
    expect(second.status).toBe(400);
  });

  it("logout clears the session", async () => {
    const sessionCookie = await loginAsUser("alice", "alice-pw", "/whoami");
    const beforeLogout = await fetch(`${runtimeUrl}/whoami`, { headers: { cookie: sessionCookie } });
    expect(beforeLogout.status).toBe(200);

    await fetch(`${runtimeUrl}/auth/logout`, { headers: { cookie: sessionCookie }, redirect: "manual" });

    const afterLogout = await fetch(`${runtimeUrl}/whoami`, { headers: { cookie: sessionCookie } });
    expect(afterLogout.status).toBe(401);
  });
});
