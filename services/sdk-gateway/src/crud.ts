import type { AppSpec, EntitySpec } from "@aiappfactory/app-spec";
import { quoteIdent, quoteLiteral } from "@aiappfactory/expr";
import type { Pool, PoolClient } from "pg";
import { EntityNotFoundError, RecordNotFoundError, UnknownColumnError } from "./errors.js";
import "./pgTypes.js"; // must run before any query touches a DATE column — see file for why
import type { RegisteredApp } from "./registry.js";

export interface ExecutionContext {
  userId: string;
  department: string;
  roles: string[];
}

export function findEntity(spec: AppSpec, name: string): EntitySpec {
  const entity = spec.data.entities.find((e) => e.name === name);
  if (!entity) throw new EntityNotFoundError(`unknown entity "${name}"`);
  return entity;
}

function assertKnownFields(entity: EntitySpec, data: Record<string, unknown>): void {
  const known = new Set(entity.fields.map((f) => f.name));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) throw new UnknownColumnError(`unknown field "${key}" on ${entity.name}`);
  }
}

/**
 * Sets the request's execution context as session-local GUCs for RLS to read
 * (ADR-007 §7.1). MUST run inside the same transaction as the query it's meant to
 * scope — `SET LOCAL` is transaction-scoped precisely so a pooled connection can
 * never leak one caller's principal into the next caller's query.
 */
async function setPrincipal(client: PoolClient, ctx: ExecutionContext): Promise<void> {
  await client.query(`SET LOCAL factory.user_id = ${quoteLiteral(ctx.userId)}`);
  await client.query(`SET LOCAL factory.department = ${quoteLiteral(ctx.department)}`);
  await client.query(`SET LOCAL factory.roles = ${quoteLiteral(ctx.roles.join(","))}`);
}

async function withTransaction<T>(pool: Pool, ctx: ExecutionContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setPrincipal(client, ctx);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const table = (app: RegisteredApp, entity: EntitySpec): string => `${quoteIdent(app.schemaName)}.${quoteIdent(entity.name)}`;

export async function listRecords(app: RegisteredApp, entityName: string, ctx: ExecutionContext): Promise<Record<string, unknown>[]> {
  const entity = findEntity(app.spec, entityName);
  return withTransaction(app.pool, ctx, async (client) => {
    // Row visibility is entirely RLS's job (ADR-007) — this query has no WHERE clause
    // of its own; the database decides which rows this principal can see.
    const { rows } = await client.query(`SELECT * FROM ${table(app, entity)} ORDER BY "createdAt" DESC LIMIT 100`);
    return rows;
  });
}

export async function createRecord(
  app: RegisteredApp,
  entityName: string,
  ctx: ExecutionContext,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entity = findEntity(app.spec, entityName);
  assertKnownFields(entity, data);

  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];

  for (const field of entity.fields) {
    if (field.type === "actor") {
      // Never client-supplied — this IS the SDK's security property (01_ARCHITECTURE §5.3).
      columns.push(quoteIdent(field.name));
      values.push(ctx.userId);
      placeholders.push(`$${values.length}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(data, field.name)) {
      columns.push(quoteIdent(field.name));
      values.push(data[field.name]);
      placeholders.push(`$${values.length}`);
    }
  }

  return withTransaction(app.pool, ctx, async (client) => {
    const sql =
      columns.length > 0
        ? `INSERT INTO ${table(app, entity)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`
        : `INSERT INTO ${table(app, entity)} DEFAULT VALUES RETURNING *`;
    const { rows } = await client.query(sql, values);
    return rows[0];
  });
}

export async function updateRecord(
  app: RegisteredApp,
  entityName: string,
  ctx: ExecutionContext,
  id: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entity = findEntity(app.spec, entityName);
  assertKnownFields(entity, data);

  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const field of entity.fields) {
    // actor fields are set once at creation and never client-mutable afterward.
    if (field.type === "actor") continue;
    if (Object.prototype.hasOwnProperty.call(data, field.name)) {
      values.push(data[field.name]);
      assignments.push(`${quoteIdent(field.name)} = $${values.length}`);
    }
  }
  assignments.push(`"updatedAt" = now()`);

  return withTransaction(app.pool, ctx, async (client) => {
    values.push(id);
    const sql = `UPDATE ${table(app, entity)} SET ${assignments.join(", ")} WHERE "id" = $${values.length} RETURNING *`;
    const { rows } = await client.query(sql, values);
    if (rows.length === 0) {
      // Could be "doesn't exist" or "exists but RLS hid it" — deliberately the same error either way.
      throw new RecordNotFoundError(`no ${entity.name} record visible to this caller with id "${id}"`);
    }
    return rows[0];
  });
}

export async function deleteRecord(app: RegisteredApp, entityName: string, ctx: ExecutionContext, id: string): Promise<void> {
  const entity = findEntity(app.spec, entityName);
  return withTransaction(app.pool, ctx, async (client) => {
    // A hard DELETE, gated by the FOR DELETE RLS policy spec-compiler generates from
    // "delete"/"delete:own" grants. The `deletedAt` column exists on every table for a
    // future soft-delete pass (04_IMPLEMENTATION §12 R-11 is about *migrations* not
    // losing data, not about this being a required app-level UX) — not wired up yet;
    // tracked in ROADMAP.md rather than half-implemented here.
    const { rowCount } = await client.query(`DELETE FROM ${table(app, entity)} WHERE "id" = $1`, [id]);
    if (!rowCount) {
      throw new RecordNotFoundError(`no ${entity.name} record visible to this caller with id "${id}"`);
    }
  });
}
