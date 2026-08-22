import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KeycloakAdminClient,
  allowUnmanagedAttributes,
  createRealm,
  createRealmRole,
  createUser,
} from "@aiappfactory/keycloak-admin";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSetupRoutes } from "../../src/routes.js";
import { SetupGuardState } from "../../src/state.js";

/**
 * Proves the T-08 setup flow end to end against a REAL Keycloak: the one-time
 * token gates creating a genuine initial admin user (not a mock), and the
 * endpoint is permanently disabled afterward. Run via `pnpm test:integration`
 * — spins up its own throwaway Keycloak container via Docker, same pattern as
 * packages/auth-bff's integration suite.
 */

const KC_CONTAINER = `aiaf-kc-setupguard-test-${Date.now()}`;
const KC_PORT = 20080 + Math.floor(Math.random() * 1000);
const KC_BASE_URL = `http://localhost:${KC_PORT}`;
const REALM = "factory-test";

let dir: string;
let app: FastifyInstance;
let kcAdmin: KeycloakAdminClient;
let setupToken: string;

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

  kcAdmin = await KeycloakAdminClient.authenticate({ baseUrl: KC_BASE_URL, adminUsername: "admin", adminPassword: "admin" });
  await createRealm(kcAdmin, REALM);
  await allowUnmanagedAttributes(kcAdmin, REALM);
  await createRealmRole(kcAdmin, REALM, "platform_admin");

  // A test-only verification client: `admin-cli`'s default realm client has
  // "lightweight access tokens" enabled, which strips realm_access.roles from
  // the token — confirmed the hard way rather than assumed. Direct grants are
  // fine here since this client exists purely to prove the created account is
  // real and has the right role; it is not the pattern real login uses
  // (that's Authorization Code + PKCE via packages/auth-bff).
  await kcAdmin.request("POST", `/admin/realms/${REALM}/clients`, {
    clientId: "verify-client",
    secret: "verify-secret",
    enabled: true,
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    attributes: { "client.use.lightweight.access.token.enabled": "false" },
  });

  dir = mkdtempSync(join(tmpdir(), "setup-guard-kc-test-"));
  const guard = SetupGuardState.load(join(dir, "state.json"));
  setupToken = guard.generateToken();

  app = Fastify({ logger: false });
  buildSetupRoutes(app, {
    guard,
    createAdmin: async ({ username, password, email }) => {
      await createUser(kcAdmin, REALM, {
        username,
        password,
        email,
        firstName: "Platform",
        lastName: "Admin",
        department: "00000000-0000-0000-0000-000000000000",
        roles: ["platform_admin"],
      });
    },
  });
}, 90_000);

afterAll(async () => {
  await app?.close();
  removeContainerIfExists();
  if (dir) rmSync(dir, { recursive: true, force: true });
}, 30_000);

describe("setup-guard + keycloak-admin: real initial admin creation", () => {
  it("completing setup actually creates a working Keycloak user with the platform_admin role", async () => {
    const token = setupToken;
    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "founder", password: "founder-pw-123", email: "founder@example.com" },
    });
    expect(res.statusCode).toBe(200);

    // Prove it's a REAL, usable account — not just an API call that returned 200 —
    // by actually logging in as it and checking the role landed correctly.
    const loginRes = await fetch(`${KC_BASE_URL}/realms/${REALM}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "verify-client",
        client_secret: "verify-secret",
        username: "founder",
        password: "founder-pw-123",
        grant_type: "password",
        scope: "openid",
      }),
    });
    expect(loginRes.status).toBe(200);
    const tokens = (await loginRes.json()) as { access_token: string };
    const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1]!, "base64").toString()) as {
      realm_access: { roles: string[] };
    };
    expect(claims.realm_access.roles).toContain("platform_admin");
  });

  it("the setup endpoint is permanently disabled after completion", async () => {
    const token = setupToken;
    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "second-admin", password: "pw", email: "b@example.com" },
    });
    expect(res.statusCode).toBe(403);
  });
});
