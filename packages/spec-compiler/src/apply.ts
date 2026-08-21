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
