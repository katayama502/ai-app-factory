import type { FastifyReply } from "fastify";

/**
 * The browser-enforced half of ADR-012 / T-02b (02_SECURITY §7.3). Distinct origins
 * alone don't stop a page from being framed or from reading data another app
 * fetched, so every response also carries: no framing at all (`X-Frame-Options` +
 * CSP `frame-ancestors`), no other origin's window can hold a reference into this
 * one (`COOP`), and this origin's responses can't be read cross-origin even by
 * request modes that would otherwise allow it (`CORP`). `connect-src 'self'` is
 * correct here because all data fetches happen server-side (this MVP renderer ships
 * no client-side JS) — a real SPA renderer will need to widen this to the SDK
 * Gateway's own origin specifically, never `*`.
 */
export function applySecurityHeaders(reply: FastifyReply): void {
  reply.header("X-Frame-Options", "DENY");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header(
    "Content-Security-Policy",
    "default-src 'self'; frame-ancestors 'none'; connect-src 'self'; style-src 'self' 'unsafe-inline'"
  );
}
