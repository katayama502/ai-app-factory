import { createCompanySdk, type CompanySdk, type ExecutionContext } from "@aiappfactory/company-sdk";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerApiRoutes } from "./api.js";
import type { RuntimeApp, RuntimeAppRegistry } from "./appRegistry.js";
import { requireDevAuth } from "./auth.js";
import type { DevUserDirectory } from "./devUsers.js";
import { handleFormSubmit, renderPage } from "./pages.js";
import { applySecurityHeaders } from "./securityHeaders.js";

declare module "fastify" {
  interface FastifyRequest {
    ctx?: ExecutionContext;
    runtimeApp?: RuntimeApp;
  }
}

export interface RuntimeServerConfig {
  registry: RuntimeAppRegistry;
  users: DevUserDirectory;
}

export function buildRuntimeServer(config: RuntimeServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(formbody); // parses application/x-www-form-urlencoded — the MVP HTML forms don't use JS/fetch
  const authenticate = requireDevAuth(config.users);

  app.addHook("onSend", async (_request, reply) => {
    applySecurityHeaders(reply);
  });

  // Which app: decided by the origin the request arrived on (ADR-012), never a path
  // segment or a client-supplied value. Resolved before auth so an unknown host
  // gets a plain 404 rather than a credential prompt for an app that doesn't exist.
  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.url === "/healthz") return;
    const runtimeApp = config.registry.resolve(request.hostname);
    if (!runtimeApp) {
      reply.code(404).send({ ok: false, error: `no app registered for host "${request.hostname}"` });
      return;
    }
    request.runtimeApp = runtimeApp;

    const ctx = await authenticate(request, reply);
    if (ctx) request.ctx = ctx;
  });

  const sdkFor = (request: FastifyRequest): CompanySdk | undefined => {
    if (!request.ctx || !request.runtimeApp) return undefined;
    return createCompanySdk({ gatewayUrl: request.runtimeApp.gatewayUrl, appId: request.runtimeApp.appId, ctx: request.ctx });
  };

  registerApiRoutes(app, sdkFor);

  app.get("/healthz", async (request, reply) => {
    const runtimeApp = config.registry.resolve(request.hostname);
    if (!runtimeApp) return reply.code(404).send({ ok: false });
    reply.send({ ok: true, appId: runtimeApp.appId });
  });

  app.get("/", async (_request, reply) => {
    reply.redirect(`/pages/0`);
  });

  app.get<{ Params: { index: string }; Querystring: { q?: string } }>(`/pages/:index`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk || !request.runtimeApp) return;
    const index = Number(request.params.index);
    const html = await renderPage(request.runtimeApp.spec, index, sdk, request.query);
    reply.type("text/html").send(html);
  });

  app.post<{ Params: { index: string }; Body: Record<string, unknown> }>(`/pages/:index`, async (request, reply) => {
    const sdk = sdkFor(request);
    if (!sdk || !request.runtimeApp) return;
    const index = Number(request.params.index);
    const redirectTo = await handleFormSubmit(request.runtimeApp.spec, index, sdk, request.body ?? {});
    reply.redirect(redirectTo);
  });

  return app;
}
