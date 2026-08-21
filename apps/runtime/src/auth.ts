import type { ExecutionContext } from "@aiappfactory/company-sdk";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DevUserDirectory } from "./devUsers.js";

const REALM = 'Basic realm="AI App Factory (dev)"';

/** Written by hand rather than pulled in as a dependency — this is the one place
 * request credentials get parsed, and keeping it small and inspectable matters more
 * here than reuse. Replaced wholesale by Keycloak + BFF (ADR-006) in M4. */
export function requireDevAuth(users: DevUserDirectory) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<ExecutionContext | undefined> => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Basic ")) {
      reply.header("WWW-Authenticate", REALM).code(401).send({ ok: false, error: "authentication required" });
      return undefined;
    }
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");
    const username = sep === -1 ? decoded : decoded.slice(0, sep);
    const password = sep === -1 ? "" : decoded.slice(sep + 1);
    const ctx = users.authenticate(username, password);
    if (!ctx) {
      reply.header("WWW-Authenticate", REALM).code(401).send({ ok: false, error: "invalid credentials" });
      return undefined;
    }
    return ctx;
  };
}
