import type { AppSpec } from "@aiappfactory/app-spec";
import { createCompanySdk, type CompanySdk, type ExecutionContext } from "@aiappfactory/company-sdk";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerApiRoutes } from "./api.js";
import { requireDevAuth } from "./auth.js";
import type { DevUserDirectory } from "./devUsers.js";
import { handleFormSubmit, renderPage } from "./pages.js";

declare module "fastify" {
  interface FastifyRequest {
    ctx?: ExecutionContext;
  }
}

export interface RuntimeServerConfig {
  spec: AppSpec;
  gatewayUrl: string;
  users: DevUserDirectory;
}

export function buildRuntimeServer(config: RuntimeServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(formbody); // parses application/x-www-form-urlencoded — the MVP HTML forms don't use JS/fetch
  const appId = config.spec.metadata.id;
  const authenticate = requireDevAuth(config.users);

  app.addHook("preHandler", async (request, reply) => {
    const ctx = await authenticate(request, reply);
    if (ctx) request.ctx = ctx;
  });

  const sdkFor = (request: FastifyRequest): CompanySdk | undefined => {
    if (!request.ctx) return undefined;
    return createCompanySdk({ gatewayUrl: config.gatewayUrl, appId, ctx: request.ctx });
  };

  registerApiRoutes(app, appId, sdkFor);

  app.get(`/apps/${appId}`, async (_request, reply) => {
    reply.redirect(`/apps/${appId}/pages/0`);
  });

  app.get<{ Params: { index: string }; Querystring: { q?: string } }>(`/apps/${appId}/pages/:index`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk) return;
    const index = Number(request.params.index);
    const html = await renderPage(config.spec, index, sdk, request.query);
    reply.type("text/html").send(html);
  });

  app.post<{ Params: { index: string }; Body: Record<string, unknown> }>(`/apps/${appId}/pages/:index`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk) return;
    const index = Number(request.params.index);
    const redirectTo = await handleFormSubmit(config.spec, index, sdk, request.body ?? {});
    reply.redirect(redirectTo);
  });

  return app;
}
