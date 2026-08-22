/**
 * Manual local-dev convenience script — NOT part of the shipped product (there is no
 * `deploy-engine` yet; this is the human substitute for it). Boots TWO templates —
 * sales-daily-report and expense-request — against a Postgres dev database AND a
 * Keycloak realm, each app served from its OWN hostname by the same apps/runtime
 * process (ADR-012: per-app origin, not per-app path — see appRegistry.ts) and gated
 * by a REAL Keycloak login (ADR-006). Run with `pnpm dev:sample`.
 *
 * `*.apps.localhost` resolves to loopback automatically on most systems/browsers
 * (RFC 6761) — no `/etc/hosts` edit needed.
 *
 * Two ways to supply Postgres + Keycloak (see README's "Try it today" / "Run via
 * Docker Compose"):
 *   1. Default (no env vars set): a local trust-authenticated Postgres superuser on
 *      127.0.0.1:5432 (same as the integration test suites) and a self-managed,
 *      auto-started Docker Keycloak container — this is the original all-local flow.
 *   2. Compose-backed (M5): `docker compose -f deploy/compose/docker-compose.yml up -d`,
 *      then set AIAF_PG_PASSWORD / AIAF_KEYCLOAK_URL / AIAF_KEYCLOAK_ADMIN_PASSWORD to
 *      match `deploy/compose/.env` — this script then connects to those containers
 *      instead of managing its own, so no local Postgres/Keycloak install is needed.
 * Idempotent either way: safe to re-run — it reuses the Postgres schema/Keycloak realm
 * if they already exist rather than re-provisioning.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicProvider, TemplatePickerProvider, type LlmProvider, type TemplateCandidate } from "@aiappfactory/ai-core";
import { parseAppSpecYaml, type AppSpec } from "@aiappfactory/app-spec";
import { createOidcAuth, type OidcAuth } from "@aiappfactory/auth-bff";
import { buildConsoleServer } from "@aiappfactory/console";
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
import { RuntimeAppRegistry, buildRuntimeServer } from "@aiappfactory/runtime";
import { AppRegistry, buildServer as buildGatewayServer } from "@aiappfactory/sdk-gateway";
import { applyMigration, applyPlatformBootstrap, compileAppSpec, roleNameFor, schemaNameFor } from "@aiappfactory/spec-compiler";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PGHOST = process.env.AIAF_PG_HOST ?? "127.0.0.1";
const PGPORT = Number(process.env.AIAF_PG_PORT ?? 5432);
const PGUSER = process.env.AIAF_PG_USER ?? process.env.PG_TEST_SUPERUSER ?? process.env.USER ?? "postgres";
const PGPASSWORD = process.env.AIAF_PG_PASSWORD; // unset => trust auth (the original local-only flow)
const DEV_DB = process.env.AIAF_PG_DATABASE ?? "aiaf_dev";
const APP_ROLE_PASSWORD = "dev-only-not-a-real-secret";

const KC_CONTAINER = "aiaf-dev-keycloak";
const KC_PORT = 8180;
// If AIAF_KEYCLOAK_URL is set, this script trusts that a Keycloak instance is already
// running there (e.g. the compose service) and never tries to docker-run its own.
const KC_BASE_URL = process.env.AIAF_KEYCLOAK_URL ?? `http://localhost:${KC_PORT}`;
const KC_ADMIN_PASSWORD = process.env.AIAF_KEYCLOAK_ADMIN_PASSWORD ?? "admin";
const MANAGE_KEYCLOAK_CONTAINER = !process.env.AIAF_KEYCLOAK_URL;
const REALM = "factory-dev";

// Fixed department UUID — NOT randomUUID(), so re-running this script keeps
// referring to the same "place". User UUIDs now come from Keycloak itself
// (createUser returns its generated id) rather than being chosen up front.
const DEPT_SALES = "00000000-0000-0000-0000-0000000000d1";

interface TemplateApp {
  templateDir: string;
  hostname: string;
  clientId: string;
}

const APPS: TemplateApp[] = [
  { templateDir: "sales-daily-report", hostname: "sales-daily-report.apps.localhost", clientId: "sales-daily-report" },
  { templateDir: "expense-request", hostname: "expense-request.apps.localhost", clientId: "expense-request" },
];

// All 5 templates (not just the 2 booted live above) — candidates for the Builder
// UI's offline TemplatePickerProvider fallback (packages/console), keyed by
// keywords a description in Japanese or English might plausibly contain.
const TEMPLATE_KEYWORDS: Record<string, string[]> = {
  "sales-daily-report": ["営業", "日報", "sales", "report"],
  "expense-request": ["経費", "精算", "expense", "receipt", "reimburse"],
  "meeting-room": ["会議室", "予約", "room", "reservation", "booking"],
  "it-equipment-request": ["it機器", "貸与", "パソコン", "laptop", "equipment", "device"],
  "vacation-request": ["休暇", "有給", "休み", "vacation", "leave", "pto"],
};

const CLIENT_SECRET = "dev-only-not-a-real-secret"; // same for every dev client — fine for local dev, never for a real deployment
const DEMO_USERNAMES = ["alice", "bob", "carol"];

async function ensureDatabase(): Promise<void> {
  const admin = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres", ...(PGPASSWORD ? { password: PGPASSWORD } : {}) });
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEV_DB]);
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE ${quoteIdent(DEV_DB)}`);
    console.log(`created database ${DEV_DB}`);
  }
  await admin.end();
}

function loadTemplate(templateDir: string): AppSpec {
  const path = join(__dirname, "..", "templates", templateDir, "app.yaml");
  const parsed = parseAppSpecYaml(readFileSync(path, "utf-8"));
  if (!parsed.ok) throw new Error(`template "${templateDir}" invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.spec;
}

async function ensureSchema(adminPool: pg.Pool, spec: AppSpec): Promise<{ schemaName: string; roleName: string }> {
  const schemaName = schemaNameFor(spec.metadata.id);
  const roleName = roleNameFor(spec.metadata.id);
  const { rows } = await adminPool.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
  if (rows.length === 0) {
    const migration = compileAppSpec(spec, { rolePassword: APP_ROLE_PASSWORD });
    await applyMigration(adminPool, migration);
    console.log(`provisioned schema ${schemaName} / role ${roleName}`);
  } else {
    console.log(`schema ${schemaName} already exists, skipping DDL`);
  }
  return { schemaName, roleName };
}

function containerStatus(): "running" | "stopped" | "missing" {
  try {
    const out = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", KC_CONTAINER], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out === "true" ? "running" : "stopped";
  } catch {
    return "missing";
  }
}

async function ensureKeycloak(): Promise<void> {
  if (MANAGE_KEYCLOAK_CONTAINER) {
    const status = containerStatus();
    if (status === "missing") {
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
        `KC_BOOTSTRAP_ADMIN_PASSWORD=${KC_ADMIN_PASSWORD}`,
        "quay.io/keycloak/keycloak:26.0",
        "start-dev",
      ]);
      console.log(`started Keycloak container "${KC_CONTAINER}"`);
    } else if (status === "stopped") {
      execFileSync("docker", ["start", KC_CONTAINER]);
      console.log(`restarted existing Keycloak container "${KC_CONTAINER}"`);
    } else {
      console.log(`Keycloak container "${KC_CONTAINER}" already running`);
    }
  } else {
    console.log(`using externally-managed Keycloak at ${KC_BASE_URL} (AIAF_KEYCLOAK_URL set)`);
  }

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

async function realmExists(admin: KeycloakAdminClient): Promise<boolean> {
  try {
    await admin.request("GET", `/admin/realms/${REALM}`);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await ensureDatabase();
  const adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: DEV_DB, ...(PGPASSWORD ? { password: PGPASSWORD } : {}) });
  await applyPlatformBootstrap(adminPool);
  await adminPool.query(`INSERT INTO public.departments (id) VALUES ($1) ON CONFLICT DO NOTHING`, [DEPT_SALES]);

  await ensureKeycloak();
  const kcAdmin = await KeycloakAdminClient.authenticate({ baseUrl: KC_BASE_URL, adminUsername: "admin", adminPassword: KC_ADMIN_PASSWORD });

  const alreadyProvisioned = await realmExists(kcAdmin);
  if (!alreadyProvisioned) {
    await createRealm(kcAdmin, REALM);
    await allowUnmanagedAttributes(kcAdmin, REALM);
    for (const role of ["sales_member", "sales_manager", "employee", "finance_approver"]) {
      await createRealmRole(kcAdmin, REALM, role);
    }
    // Realistic overlap: the same person can hold different roles in different apps —
    // alice/bob are ordinary staff, carol is a manager in both contexts.
    await createUser(kcAdmin, REALM, {
      username: "alice",
      password: "alice-dev",
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Sales",
      department: DEPT_SALES,
      roles: ["sales_member", "employee"],
    });
    await createUser(kcAdmin, REALM, {
      username: "bob",
      password: "bob-dev",
      email: "bob@example.com",
      firstName: "Bob",
      lastName: "Sales",
      department: DEPT_SALES,
      roles: ["sales_member", "employee"],
    });
    await createUser(kcAdmin, REALM, {
      username: "carol",
      password: "carol-dev",
      email: "carol@example.com",
      firstName: "Carol",
      lastName: "Manager",
      department: DEPT_SALES,
      roles: ["sales_manager", "finance_approver"],
    });
    console.log(`provisioned realm "${REALM}" (roles + alice/bob/carol)`);
  } else {
    console.log(`realm "${REALM}" already provisioned, skipping`);
  }

  const gatewayRegistry = new AppRegistry();
  const runtimeRegistry = new RuntimeAppRegistry();

  for (const { templateDir, hostname, clientId } of APPS) {
    const spec = loadTemplate(templateDir);
    const { schemaName, roleName } = await ensureSchema(adminPool, spec);
    const pool = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleName, password: APP_ROLE_PASSWORD, database: DEV_DB });
    gatewayRegistry.register(spec.metadata.id, { spec, pool, schemaName });

    const redirectUri = `http://${hostname}:4200/auth/callback`;
    if (!alreadyProvisioned) {
      const clientUuid = await createConfidentialClient(kcAdmin, REALM, { clientId, secret: CLIENT_SECRET, redirectUris: [redirectUri] });
      await addClaimsMappers(kcAdmin, REALM, clientUuid);
    }
    const oidcAuth: OidcAuth = await createOidcAuth({
      issuerUrl: `${KC_BASE_URL}/realms/${REALM}`,
      clientId,
      clientSecret: CLIENT_SECRET,
      redirectUri,
    });

    runtimeRegistry.register(hostname, { appId: spec.metadata.id, spec, gatewayUrl: "http://127.0.0.1:4100", oidcAuth });
  }

  const gateway = buildGatewayServer(gatewayRegistry);
  await gateway.listen({ port: 4100, host: "127.0.0.1" });

  const runtime = buildRuntimeServer({ registry: runtimeRegistry });
  await runtime.listen({ port: 4200, host: "::" });

  // Builder UI (packages/console): real Claude generation if ANTHROPIC_API_KEY is
  // set, otherwise a zero-config offline fallback that picks among ALL 5 shipped
  // templates by keyword match — so "describe an app" works with nothing to sign
  // up for or pay, out of the box.
  const usingRealProvider = Boolean(process.env.ANTHROPIC_API_KEY);
  const provider: LlmProvider = usingRealProvider
    ? new AnthropicProvider()
    : new TemplatePickerProvider(
        Object.entries(TEMPLATE_KEYWORDS).map(
          ([templateDir, keywords]): TemplateCandidate => ({ spec: loadTemplate(templateDir), keywords })
        )
      );

  const console_ = buildConsoleServer({
    provider,
    usingRealProvider,
    publishDeps: {
      adminPool,
      pgHost: PGHOST,
      pgPort: PGPORT,
      devDb: DEV_DB,
      appRolePassword: APP_ROLE_PASSWORD,
      kcAdmin,
      kcBaseUrl: KC_BASE_URL,
      realm: REALM,
      clientSecret: CLIENT_SECRET,
      gatewayRegistry,
      runtimeRegistry,
      gatewayUrl: "http://127.0.0.1:4100",
      runtimePort: 4200,
      demoUsernames: DEMO_USERNAMES,
    },
  });
  await console_.listen({ port: 4300, host: "127.0.0.1" });

  console.log("");
  console.log(`sdk-gateway : http://127.0.0.1:4100 (internal API only)`);
  console.log(`keycloak    : ${KC_BASE_URL} (admin/${KC_ADMIN_PASSWORD})`);
  for (const { hostname } of APPS) {
    console.log(`runtime     : http://${hostname}:4200/pages/0`);
  }
  console.log(`builder     : http://127.0.0.1:4300 (${usingRealProvider ? "real AI" : "offline demo mode"} — describe an app, generate, publish)`);
  console.log(`dev users   : alice/alice-dev, bob/bob-dev, carol/carol-dev`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
