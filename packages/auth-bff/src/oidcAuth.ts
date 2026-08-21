import * as client from "openid-client";
import { SessionStore } from "./sessionStore.js";
import type { OidcAuthOptions, SessionClaims } from "./types.js";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h — matches ADR-006's refresh-token lifetime target

export class OidcCallbackError extends Error {}

export interface OidcAuth {
  /** Builds the redirect URL to Keycloak's authorize endpoint and remembers the PKCE verifier/state/nonce this login attempt needs at callback time. One `OidcAuth` per app (ADR-006: each app is its own OIDC client) — call this on the app the request's Host resolved to, never a shared/default one. */
  startLogin(returnTo: string): Promise<URL>;
  /** Exchanges the code, validates state/nonce/PKCE, and returns the resolved session claims. Throws `OidcCallbackError` for any failure (unknown/expired/replayed state, failed token exchange, or a token missing the department/roles claims this platform requires). */
  completeLogin(callbackUrl: URL): Promise<{ claims: SessionClaims; returnTo: string }>;
  createSession(claims: SessionClaims): string;
  resolveSession(sid: string | undefined): SessionClaims | undefined;
  destroySession(sid: string | undefined): void;
}

function extractClaims(idTokenClaims: Record<string, unknown>): SessionClaims | undefined {
  const sub = idTokenClaims.sub;
  const department = idTokenClaims.department;
  const realmAccess = idTokenClaims.realm_access as { roles?: unknown } | undefined;
  const roles = realmAccess?.roles;
  if (typeof sub !== "string" || typeof department !== "string" || !Array.isArray(roles)) {
    return undefined; // provisioning didn't set up the department/realm-roles mappers correctly
  }
  const name = idTokenClaims.name;
  return {
    userId: sub,
    department,
    roles: roles.filter((r): r is string => typeof r === "string"),
    ...(typeof name === "string" ? { name } : {}),
  };
}

/**
 * Wires the Authorization Code + PKCE flow (ADR-006) against a real Keycloak realm.
 * Deliberately does NOT register Fastify routes itself: a Runtime process hosts
 * MULTIPLE apps behind ONE set of `/auth/login`, `/auth/callback`, `/auth/logout`
 * paths (ADR-012 — apps are distinguished by origin/Host, not a URL path segment),
 * so route registration has to happen exactly once, dispatching to whichever app's
 * `OidcAuth` instance the resolved Host maps to. See apps/runtime/src/server.ts.
 */
export async function createOidcAuth(opts: OidcAuthOptions): Promise<OidcAuth> {
  const isInsecureIssuer = new URL(opts.issuerUrl).protocol === "http:";
  // allowInsecureRequests must be threaded through discovery() itself — by the time
  // discovery() returns a Configuration, it has ALREADY made an HTTPS-only request to
  // fetch the discovery document, so calling allowInsecureRequests(config) afterward
  // is too late for that first request (confirmed the hard way against a real
  // instance). Local dev only — no TLS between this BFF and Keycloak yet (ROADMAP.md).
  const config = await client.discovery(
    new URL(opts.issuerUrl),
    opts.clientId,
    { client_secret: opts.clientSecret },
    client.ClientSecretPost(opts.clientSecret),
    isInsecureIssuer ? { execute: [client.allowInsecureRequests] } : undefined
  );

  const store = new SessionStore();
  const ttl = opts.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const redirectUri = new URL(opts.redirectUri);

  return {
    async startLogin(returnTo: string): Promise<URL> {
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      store.createPendingLogin(codeVerifier, state, nonce, returnTo);

      return client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri.href,
        scope: "openid",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
    },

    async completeLogin(callbackUrl: URL) {
      const state = callbackUrl.searchParams.get("state") ?? undefined;
      const pending = state ? store.consumePendingLogin(state) : undefined;
      if (!pending) {
        throw new OidcCallbackError("unknown or expired login attempt (missing/invalid/replayed state)");
      }

      let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
      try {
        tokens = await client.authorizationCodeGrant(config, callbackUrl, {
          pkceCodeVerifier: pending.codeVerifier,
          expectedState: pending.state,
          expectedNonce: pending.nonce,
        });
      } catch (error) {
        throw new OidcCallbackError(`token exchange failed: ${(error as Error).message}`);
      }

      const idTokenClaims = tokens.claims();
      const claims = idTokenClaims ? extractClaims(idTokenClaims as unknown as Record<string, unknown>) : undefined;
      if (!claims) {
        throw new OidcCallbackError("ID token missing department/realm role claims — is the realm provisioned correctly?");
      }

      return { claims, returnTo: pending.returnTo };
    },

    createSession(claims: SessionClaims): string {
      return store.createSession(claims, ttl);
    },

    resolveSession(sid: string | undefined): SessionClaims | undefined {
      return store.resolveSession(sid);
    },

    destroySession(sid: string | undefined): void {
      store.destroySession(sid);
    },
  };
}
