import Fastify, { type FastifyInstance } from "fastify";
import { createRecord, deleteRecord, listRecords, updateRecord } from "./crud.js";
import type { ExecutionContext } from "./crud.js";
import { AppNotFoundError, EntityNotFoundError, RecordNotFoundError, UnknownColumnError } from "./errors.js";
import type { AppRegistry } from "./registry.js";

function isValidCtx(value: unknown): value is ExecutionContext {
  if (typeof value !== "object" || value === null) return false;
  const ctx = value as Record<string, unknown>;
  return (
    typeof ctx.userId === "string" &&
    ctx.userId.length > 0 &&
    typeof ctx.department === "string" &&
    ctx.department.length > 0 &&
    Array.isArray(ctx.roles) &&
    ctx.roles.every((r) => typeof r === "string")
  );
}

/** Builds the Fastify app. Not started here — call `.listen()` on the result, or use it directly in tests via `.inject()`. */
export function buildServer(registry: AppRegistry): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppNotFoundError) return reply.code(404).send({ ok: false, error: error.message });
    if (error instanceof EntityNotFoundError) return reply.code(404).send({ ok: false, error: error.message });
    if (error instanceof RecordNotFoundError) return reply.code(404).send({ ok: false, error: error.message });
    if (error instanceof UnknownColumnError) return reply.code(400).send({ ok: false, error: error.message });
    // Postgres insufficient_privilege (e.g. no role in the Spec grants "delete") —
    // the base GRANT itself blocked the command before RLS even had a policy to check.
    if ((error as { code?: string }).code === "42501") {
      return reply.code(403).send({ ok: false, error: "permission denied" });
    }
    // Deliberately not more specific than this for anything else — see TODO below.
    reply.code(500).send({ ok: false, error: "internal error" });
  });

  app.post<{ Params: { appId: string; entity: string }; Body: { ctx: unknown } }>(
    "/internal/apps/:appId/entities/:entity/list",
    async (request, reply) => {
      const { appId, entity } = request.params;
      const { ctx } = request.body;
      if (!isValidCtx(ctx)) return reply.code(400).send({ ok: false, error: "invalid ctx" });
      const registered = registry.get(appId);
      const rows = await listRecords(registered, entity, ctx);
      return reply.send({ ok: true, rows });
    }
  );

  app.post<{ Params: { appId: string; entity: string }; Body: { ctx: unknown; data?: Record<string, unknown> } }>(
    "/internal/apps/:appId/entities/:entity/create",
    async (request, reply) => {
      const { appId, entity } = request.params;
      const { ctx, data } = request.body;
      if (!isValidCtx(ctx)) return reply.code(400).send({ ok: false, error: "invalid ctx" });
      const registered = registry.get(appId);
      const row = await createRecord(registered, entity, ctx, data ?? {});
      return reply.code(201).send({ ok: true, row });
    }
  );

  app.post<{ Params: { appId: string; entity: string }; Body: { ctx: unknown; id?: string; data?: Record<string, unknown> } }>(
    "/internal/apps/:appId/entities/:entity/update",
    async (request, reply) => {
      const { appId, entity } = request.params;
      const { ctx, id, data } = request.body;
      if (!isValidCtx(ctx)) return reply.code(400).send({ ok: false, error: "invalid ctx" });
      if (!id) return reply.code(400).send({ ok: false, error: "missing id" });
      const registered = registry.get(appId);
      const row = await updateRecord(registered, entity, ctx, id, data ?? {});
      return reply.send({ ok: true, row });
    }
  );

  app.post<{ Params: { appId: string; entity: string }; Body: { ctx: unknown; id?: string } }>(
    "/internal/apps/:appId/entities/:entity/delete",
    async (request, reply) => {
      const { appId, entity } = request.params;
      const { ctx, id } = request.body;
      if (!isValidCtx(ctx)) return reply.code(400).send({ ok: false, error: "invalid ctx" });
      if (!id) return reply.code(400).send({ ok: false, error: "missing id" });
      const registered = registry.get(appId);
      await deleteRecord(registered, entity, ctx, id);
      return reply.send({ ok: true });
    }
  );

  return app;
}

// TODO(M3): the 500 branch above leaks nothing today, but once Security Gate /
// audit logging exist, an unexpected DB error here should also emit an audit event —
// tracked in ROADMAP.md, not implemented yet.
