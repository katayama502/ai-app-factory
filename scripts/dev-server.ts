/**
 * Manual local-dev convenience script — NOT part of the shipped product (there is no
 * `deploy-engine` yet; this is the human substitute for it). Boots the sales-daily-report
 * template against a persistent local Postgres dev database, then starts sdk-gateway
 * and apps/runtime so a person (or a browser-automation check) can actually click
 * around. Run with `pnpm dev:sample`.
 *
 * Requires the same local Postgres superuser as the integration test suites
 * (127.0.0.1:5432, trust-authenticated — see README's "Try it today"). Idempotent:
 * safe to re-run, it skips schema creation if the app schema already exists.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { quoteIdent } from "@aiappfactory/expr";
import { AppRegistry, buildServer as buildGatewayServer } from "@aiappfactory/sdk-gateway";
import { applyMigration, applyPlatformBootstrap, compileAppSpec, roleNameFor, schemaNameFor } from "@aiappfactory/spec-compiler";
import { DevUserDirectory, buildRuntimeServer } from "@aiappfactory/runtime";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PGHOST = "127.0.0.1";
const PGPORT = 5432;
const PGUSER = process.env.PG_TEST_SUPERUSER ?? process.env.USER ?? "postgres";
const DEV_DB = "aiaf_dev";
const APP_ROLE_PASSWORD = "dev-only-not-a-real-secret";

// Fixed, deterministic dev identities — NOT randomUUID(), so re-running this script
// keeps referring to the same "people".
const DEPT_SALES = "00000000-0000-0000-0000-0000000000d1";
const ALICE = "00000000-0000-0000-0000-00000000a11c";
const BOB = "00000000-0000-0000-0000-00000000b0b0";
const CAROL = "00000000-0000-0000-0000-0000000ca201";

async function ensureDatabase(): Promise<void> {
  const admin = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: "postgres" });
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEV_DB]);
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE ${quoteIdent(DEV_DB)}`);
    console.log(`created database ${DEV_DB}`);
  }
  await admin.end();
}

async function main(): Promise<void> {
  await ensureDatabase();
  const adminPool = new pg.Pool({ host: PGHOST, port: PGPORT, user: PGUSER, database: DEV_DB });

  await applyPlatformBootstrap(adminPool);
  await adminPool.query(`INSERT INTO public.departments (id) VALUES ($1) ON CONFLICT DO NOTHING`, [DEPT_SALES]);
  await adminPool.query(
    `INSERT INTO public.users (id, department_id) VALUES ($1, $2), ($3, $2), ($4, $2) ON CONFLICT DO NOTHING`,
    [ALICE, DEPT_SALES, BOB, CAROL]
  );

  const templatePath = join(__dirname, "..", "templates", "sales-daily-report", "app.yaml");
  const parsed = parseAppSpecYaml(readFileSync(templatePath, "utf-8"));
  if (!parsed.ok) throw new Error(`template invalid: ${JSON.stringify(parsed.issues)}`);
  const appId = parsed.spec.metadata.id;
  const schemaName = schemaNameFor(appId);
  const roleName = roleNameFor(appId);

  const { rows: existing } = await adminPool.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
  if (existing.length === 0) {
    const migration = compileAppSpec(parsed.spec, { rolePassword: APP_ROLE_PASSWORD });
    await applyMigration(adminPool, migration);
    console.log(`provisioned schema ${schemaName} / role ${roleName}`);
  } else {
    console.log(`schema ${schemaName} already exists, skipping DDL`);
  }

  const appRolePool = new pg.Pool({ host: PGHOST, port: PGPORT, user: roleName, password: APP_ROLE_PASSWORD, database: DEV_DB });
  const registry = new AppRegistry();
  registry.register(appId, { spec: parsed.spec, pool: appRolePool, schemaName });

  const gateway = buildGatewayServer(registry);
  await gateway.listen({ port: 4100, host: "127.0.0.1" });

  const users = new DevUserDirectory();
  users.add("alice", { password: "alice-dev", ctx: { userId: ALICE, department: DEPT_SALES, roles: ["sales_member"] } });
  users.add("bob", { password: "bob-dev", ctx: { userId: BOB, department: DEPT_SALES, roles: ["sales_member"] } });
  users.add("carol", { password: "carol-dev", ctx: { userId: CAROL, department: DEPT_SALES, roles: ["sales_manager"] } });

  const runtime = buildRuntimeServer({ spec: parsed.spec, gatewayUrl: "http://127.0.0.1:4100", users });
  await runtime.listen({ port: 4200, host: "127.0.0.1" });

  console.log("");
  console.log(`sdk-gateway : http://127.0.0.1:4100 (internal API only)`);
  console.log(`runtime     : http://127.0.0.1:4200/apps/${appId}/pages/0`);
  console.log(`dev users   : alice/alice-dev, bob/bob-dev (sales_member), carol/carol-dev (sales_manager)`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
