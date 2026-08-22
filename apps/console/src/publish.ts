import type { AppSpec } from "@aiappfactory/app-spec";
import { createOidcAuth } from "@aiappfactory/auth-bff";
import {
  addClaimsMappers,
  assignRealmRoleToUser,
  createConfidentialClient,
  ensureRealmRole,
  findUserIdByUsername,
  type KeycloakAdminClient,
} from "@aiappfactory/keycloak-admin";
import type { RuntimeAppRegistry } from "@aiappfactory/runtime";
import { AppNotFoundError, type AppRegistry } from "@aiappfactory/sdk-gateway";
import { applyMigration, compileAppSpec, roleNameFor, schemaNameFor } from "@aiappfactory/spec-compiler";
import pg from "pg";

export interface PublishDeps {
  /** Superuser/admin pool — the only one allowed to run DDL (compileAppSpec's output). */
  adminPool: pg.Pool;
  pgHost: string;
  pgPort: number;
  devDb: string;
  /** Same convention as scripts/dev-server.ts: one fixed password for every app's low-privilege DB role, in this local/dev context only. */
  appRolePassword: string;
  kcAdmin: KeycloakAdminClient;
  kcBaseUrl: string;
  realm: string;
  /** Same convention as scripts/dev-server.ts: one fixed OIDC client secret for every dev client. */
  clientSecret: string;
  gatewayRegistry: AppRegistry;
  runtimeRegistry: RuntimeAppRegistry;
  gatewayUrl: string;
  runtimePort: number;
  /** Existing demo usernames (e.g. alice/bob/carol) to retroactively grant the new Spec's first-listed role — so whoever just published it can log in and try it immediately without a separate user-management step. */
  demoUsernames: string[];
}

export interface PublishResult {
  hostname: string;
  url: string;
  /** True if this app id was already live — publishing is idempotent, not an error, but nothing new happened. */
  alreadyPublished: boolean;
}

function isRegistered(registry: AppRegistry, appId: string): boolean {
  try {
    registry.get(appId);
    return true;
  } catch (error) {
    if (error instanceof AppNotFoundError) return false;
    throw error;
  }
}

/**
 * Takes a validated App Spec — freshly generated (or picked) by the Builder UI —
 * and makes it a real, live, loggable-into app, using EXACTLY the same
 * provisioning steps `scripts/dev-server.ts` runs for its hand-written templates
 * (schema/role DDL via spec-compiler, a Keycloak realm role per `access.roles`, a
 * dedicated confidential OIDC client with claims mappers — ADR-006's "each app is
 * its own OIDC client", not reused across apps), just triggered at runtime instead
 * of once at process startup. `gatewayRegistry`/`runtimeRegistry` are the SAME
 * live, in-memory registry instances the already-running sdk-gateway/runtime
 * Fastify servers read from — registering into them here takes effect immediately,
 * no restart.
 *
 * Idempotent at the "is this app id already live" level (returns
 * `alreadyPublished: true` rather than erroring or re-provisioning) — NOT
 * idempotent against a partial failure mid-publish (e.g. the Keycloak client got
 * created but the DB schema didn't) — a known simplification for this lightweight
 * slice, not a claimed guarantee.
 */
export async function publishGeneratedApp(spec: AppSpec, deps: PublishDeps): Promise<PublishResult> {
  const schemaName = schemaNameFor(spec.metadata.id);
  const roleName = roleNameFor(spec.metadata.id);
  const hostname = `${spec.metadata.id}.apps.localhost`;
  const url = `http://${hostname}:${deps.runtimePort}/pages/0`;

  if (isRegistered(deps.gatewayRegistry, spec.metadata.id)) {
    return { hostname, url, alreadyPublished: true };
  }

  const { rows } = await deps.adminPool.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schemaName]);
  if (rows.length === 0) {
    const migration = compileAppSpec(spec, { rolePassword: deps.appRolePassword });
    await applyMigration(deps.adminPool, migration);
  }

  const pool = new pg.Pool({ host: deps.pgHost, port: deps.pgPort, user: roleName, password: deps.appRolePassword, database: deps.devDb });
  deps.gatewayRegistry.register(spec.metadata.id, { spec, pool, schemaName });

  for (const roleGrant of spec.access.roles) {
    await ensureRealmRole(deps.kcAdmin, deps.realm, roleGrant.role);
  }

  const redirectUri = `http://${hostname}:${deps.runtimePort}/auth/callback`;
  const clientUuid = await createConfidentialClient(deps.kcAdmin, deps.realm, {
    clientId: spec.metadata.id,
    secret: deps.clientSecret,
    redirectUris: [redirectUri],
  });
  await addClaimsMappers(deps.kcAdmin, deps.realm, clientUuid);

  const firstRole = spec.access.roles[0]?.role;
  if (firstRole) {
    for (const username of deps.demoUsernames) {
      const userId = await findUserIdByUsername(deps.kcAdmin, deps.realm, username);
      if (userId) await assignRealmRoleToUser(deps.kcAdmin, deps.realm, userId, firstRole);
    }
  }

  const oidcAuth = await createOidcAuth({
    issuerUrl: `${deps.kcBaseUrl}/realms/${deps.realm}`,
    clientId: spec.metadata.id,
    clientSecret: deps.clientSecret,
    redirectUri,
  });
  deps.runtimeRegistry.register(hostname, { appId: spec.metadata.id, spec, gatewayUrl: deps.gatewayUrl, oidcAuth });

  return { hostname, url, alreadyPublished: false };
}
