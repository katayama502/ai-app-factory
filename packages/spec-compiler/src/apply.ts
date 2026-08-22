import { quoteIdent } from "@aiappfactory/expr";
import type { Pool, PoolClient } from "pg";
import type { CompiledMigration } from "./compile.js";
import { PLATFORM_BOOTSTRAP_STATEMENTS } from "./platform.js";

async function runInTransaction(pool: Pool, statements: readonly string[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs once per cluster, before compiling any app (see platform.ts). Idempotent (`CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE`). */
export async function applyPlatformBootstrap(pool: Pool): Promise<void> {
  await runInTransaction(pool, PLATFORM_BOOTSTRAP_STATEMENTS);
}

/** Applies a compiled migration as a superuser/admin pool connection (not the app's own low-privilege role — that role doesn't exist yet at this point). */
export async function applyMigration(pool: Pool, migration: CompiledMigration): Promise<void> {
  await runInTransaction(pool, migration.statements);
}

export interface ArchiveResult {
  /** Whether the schema (and everything in it — tables, computed columns, RLS policies) existed and was dropped. */
  schemaDropped: boolean;
  /** Whether the app's low-privilege role existed and was dropped. */
  roleDropped: boolean;
}

/**
 * Reverses `schemaAndRoleStatements`/`compileAppSpec`'s provisioning when an app is
 * archived (04_IMPLEMENTATION E9-8 "ARCHIVED 時のリソース回収（DBスキーマ / ロール ...）").
 * Idempotent and safe to call on an app that was already archived, or never
 * provisioned at all — existence is checked first rather than relying on
 * `IF EXISTS`, because `DROP OWNED BY` (needed to release every privilege the role
 * was ever granted, e.g. `EXECUTE` on the platform resolver functions in `public`)
 * has no `IF EXISTS` form and errors on a role that doesn't exist.
 */
export async function archiveApp(pool: Pool, schemaName: string, roleName: string): Promise<ArchiveResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: schemaRows } = await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schemaName]);
    const schemaDropped = schemaRows.length > 0;
    if (schemaDropped) {
      await client.query(`DROP SCHEMA ${quoteIdent(schemaName)} CASCADE`);
    }

    const { rows: roleRows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
    const roleDropped = roleRows.length > 0;
    if (roleDropped) {
      await client.query(`DROP OWNED BY ${quoteIdent(roleName)}`);
      await client.query(`DROP ROLE ${quoteIdent(roleName)}`);
    }

    await client.query("COMMIT");
    return { schemaDropped, roleDropped };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
