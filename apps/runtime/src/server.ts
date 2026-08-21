import { OidcCallbackError, buildExpiredCookie, buildSessionCookie, parseCookieHeader, sessionCookieName } from "@aiappfactory/auth-bff";
import { createCompanySdk, type CompanySdk, type ExecutionContext } from "@aiappfactory/company-sdk";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerApiRoutes } from "./api.js";
import type { RuntimeApp, RuntimeAppRegistry } from "./appRegistry.js";
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
}

const AUTH_PATHS = new Set(["/auth/login", "/auth/callback", "/auth/logout"]);

function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === "https";
}

function sessionIdFrom(request: FastifyRequest): string | undefined {
  return parseCookieHeader(request.headers.cookie)[sessionCookieName(isSecureRequest(request))];
}

export function buildRuntimeServer(config: RuntimeServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(formbody); // parses application/x-www-form-urlencoded — the MVP HTML forms don't use JS/fetch

  app.addHook("onSend", async (_request, reply) => {
    applySecurityHeaders(reply);
  });

  // Which app: decided by the origin the request arrived on (ADR-012), never a path
  // segment or a client-supplied value. Resolved before auth so an unknown host gets
  // a plain 404 rather than a login redirect for an app that doesn't exist.
  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.url === "/healthz") return;

    const runtimeApp = config.registry.resolve(request.hostname);
    if (!runtimeApp) {
      reply.code(404).send({ ok: false, error: `no app registered for host "${request.hostname}"` });
      return;
    }
    request.runtimeApp = runtimeApp;

    if (AUTH_PATHS.has(request.routeOptions.url ?? "")) return; // the login/callback/logout flow doesn't require an existing session

    const claims = runtimeApp.oidcAuth.resolveSession(sessionIdFrom(request));
    if (!claims) {
      const isApiRequest = (request.routeOptions.url ?? "").startsWith("/api/");
      if (isApiRequest) {
        reply.code(401).send({ ok: false, error: "authentication required" });
      } else {
        const returnTo = request.url; // path + query, e.g. "/pages/1?q=acme"
        reply.redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      }
      return;
    }
    request.ctx = { userId: claims.userId, department: claims.department, roles: claims.roles };
  });

  app.get<{ Querystring: { returnTo?: string } }>("/auth/login", async (request, reply) => {
    const url = await request.runtimeApp!.oidcAuth.startLogin(request.query.returnTo ?? "/");
    reply.redirect(url.href);
  });

  app.get("/auth/callback", async (request, reply) => {
    const runtimeApp = request.runtimeApp!;
    try {
      // MUST include the port — openid-client derives the redirect_uri it sends to
      // the token endpoint from this URL's origin, and Keycloak rejects the exchange
      // if it doesn't match what was registered byte-for-byte (confirmed the hard
      // way: request.hostname alone silently drops a non-default port).
      const currentUrl = new URL(request.url, `${request.protocol}://${request.headers.host}`);
      const { claims, returnTo } = await runtimeApp.oidcAuth.completeLogin(currentUrl);
      const sid = runtimeApp.oidcAuth.createSession(claims);
      const secure = isSecureRequest(request);
      reply.header("set-cookie", buildSessionCookie(sessionCookieName(secure), sid, secure, 8 * 60 * 60));
      reply.redirect(returnTo);
    } catch (error) {
      if (error instanceof OidcCallbackError) {
        reply.code(400).send({ ok: false, error: error.message });
        return;
      }
      throw error;
    }
  });

  app.get("/auth/logout", async (request, reply) => {
    const runtimeApp = request.runtimeApp!;
    const secure = isSecureRequest(request);
    runtimeApp.oidcAuth.destroySession(sessionIdFrom(request));
    reply.header("set-cookie", buildExpiredCookie(sessionCookieName(secure), secure));
    reply.redirect("/");
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
