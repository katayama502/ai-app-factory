import { SdkGatewayError, type CompanySdk } from "@aiappfactory/company-sdk";
import type { FastifyInstance } from "fastify";

/** Maps an SdkGatewayError's HTTP status straight through — sdk-gateway already made the authorization/validation decision; the Runtime's API layer doesn't re-decide it. */
function sendGatewayError(reply: import("fastify").FastifyReply, error: unknown): void {
  if (error instanceof SdkGatewayError) {
    reply.code(error.status).send({ ok: false, error: error.message });
    return;
  }
  reply.code(500).send({ ok: false, error: "internal error" });
}

/** The browser/API-facing REST surface (04_IMPLEMENTATION E1-3), generated per entity from the Spec. Every handler goes through Company SDK — this process has no other way to reach the data. */
export function registerApiRoutes(app: FastifyInstance, appId: string, sdkFor: (request: import("fastify").FastifyRequest) => CompanySdk | undefined): void {
  app.get<{ Params: { entity: string } }>(`/apps/${appId}/api/:entity`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk) return; // 401 already sent by the auth hook
    try {
      const rows = await sdk.database.entity(request.params.entity).list();
      reply.send({ ok: true, rows });
    } catch (error) {
      sendGatewayError(reply, error);
    }
  });

  app.post<{ Params: { entity: string }; Body: Record<string, unknown> }>(`/apps/${appId}/api/:entity`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk) return;
    try {
      const row = await sdk.database.entity(request.params.entity).create(request.body ?? {});
      reply.code(201).send({ ok: true, row });
    } catch (error) {
      sendGatewayError(reply, error);
    }
  });

  app.put<{ Params: { entity: string; id: string }; Body: Record<string, unknown> }>(
    `/apps/${appId}/api/:entity/:id`,
    async (request, reply) => {
      const sdk = sdkFor(request);
      if (!sdk) return;
      try {
        const row = await sdk.database.entity(request.params.entity).update(request.params.id, request.body ?? {});
        reply.send({ ok: true, row });
      } catch (error) {
        sendGatewayError(reply, error);
      }
    }
  );

  app.delete<{ Params: { entity: string; id: string } }>(`/apps/${appId}/api/:entity/:id`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk) return;
    try {
      await sdk.database.entity(request.params.entity).delete(request.params.id);
      reply.send({ ok: true });
    } catch (error) {
      sendGatewayError(reply, error);
    }
  });
}
