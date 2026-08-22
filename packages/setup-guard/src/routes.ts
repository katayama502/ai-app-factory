import type { FastifyInstance } from "fastify";
import type { SetupGuardState } from "./state.js";

export interface AdminInput {
  username: string;
  password: string;
  email: string;
}

export interface SetupRoutesOptions {
  guard: SetupGuardState;
  /** Actually provisions the initial admin — injected so setup-guard doesn't hard-depend on Keycloak specifics (see scripts/dev-server.ts / a real deploy for what this closure does). */
  createAdmin: (input: AdminInput) => Promise<void>;
  /** Defense in depth beyond whatever the process's own `.listen()` host binding is (04_IMPLEMENTATION §2: "127.0.0.1 バインド既定") — a misconfigured bind or an intermediary proxy shouldn't be the only thing standing between `/setup` and the internet. */
  allowedRemoteAddresses?: string[];
}

const DEFAULT_LOOPBACK_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/**
 * Registered as a Fastify plugin (`app.register`) rather than adding hooks
 * directly to the passed-in instance — Fastify's encapsulation means the
 * loopback-only preHandler hook here only ever applies to `/setup*`, never to
 * unrelated routes a caller registers on the same top-level app afterward.
 */
export function buildSetupRoutes(app: FastifyInstance, opts: SetupRoutesOptions): void {
  const allowed = new Set(opts.allowedRemoteAddresses ?? DEFAULT_LOOPBACK_ADDRESSES);

  app.register(async (instance) => {
    instance.addHook("preHandler", async (request, reply) => {
      if (!allowed.has(request.ip)) {
        reply.code(403).send({ ok: false, error: "setup is only reachable from localhost" });
      }
    });

    instance.get("/setup/status", async (_request, reply) => {
      reply.send({ ok: true, hasToken: opts.guard.hasToken(), completed: opts.guard.isCompleted() });
    });

    instance.post<{ Body: { token?: string; username?: string; password?: string; email?: string } }>(
      "/setup",
      async (request, reply) => {
        if (opts.guard.isCompleted()) {
          reply.code(403).send({ ok: false, error: "setup already completed" });
          return;
        }

        const { token, username, password, email } = request.body ?? {};
        if (!token || !opts.guard.verifyToken(token)) {
          reply.code(403).send({ ok: false, error: "invalid or missing setup token" });
          return;
        }
        if (!username || !password || !email) {
          reply.code(400).send({ ok: false, error: "username, password, and email are required" });
          return;
        }

        await opts.createAdmin({ username, password, email });
        // Marked AFTER createAdmin succeeds — if admin creation throws, setup
        // stays open so a retry with the same token is still possible instead
        // of permanently locking the operator out on a transient failure.
        opts.guard.markCompleted();
        reply.send({ ok: true });
      }
    );
  });
}
