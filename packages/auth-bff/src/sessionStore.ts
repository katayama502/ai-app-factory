import { randomBytes } from "node:crypto";
import type { SessionClaims } from "./types.js";

interface StoredSession {
  claims: SessionClaims;
  expiresAt: number;
}

interface PendingLogin {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}

const PENDING_LOGIN_TTL_MS = 5 * 60_000; // generous — a human filling in Keycloak's login form

/**
 * Both stores are in-memory `Map`s — correct for a single Runtime process (today's
 * reality) but NOT for a horizontally-scaled deployment, where a session started on
 * one instance would be invisible to another. A real deployment needs this backed by
 * Valkey (already in the platform services list — 01_ARCHITECTURE §2.1) before
 * running more than one Runtime replica. Tracked in ROADMAP.md, not solved here.
 */
export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly pendingLogins = new Map<string, PendingLogin>();

  createPendingLogin(codeVerifier: string, state: string, nonce: string, returnTo: string): void {
    this.sweepPendingLogins();
    this.pendingLogins.set(state, { codeVerifier, state, nonce, returnTo, createdAt: Date.now() });
  }

  /** One-shot: a state value is consumed and removed, so a replayed callback URL can never succeed twice. */
  consumePendingLogin(state: string): PendingLogin | undefined {
    const pending = this.pendingLogins.get(state);
    this.pendingLogins.delete(state);
    if (!pending) return undefined;
    if (Date.now() - pending.createdAt > PENDING_LOGIN_TTL_MS) return undefined;
    return pending;
  }

  private sweepPendingLogins(): void {
    const cutoff = Date.now() - PENDING_LOGIN_TTL_MS;
    for (const [state, pending] of this.pendingLogins) {
      if (pending.createdAt < cutoff) this.pendingLogins.delete(state);
    }
  }

  createSession(claims: SessionClaims, ttlSeconds: number): string {
    const sid = randomBytes(32).toString("base64url");
    this.sessions.set(sid, { claims, expiresAt: Date.now() + ttlSeconds * 1000 });
    return sid;
  }

  resolveSession(sid: string | undefined): SessionClaims | undefined {
    if (!sid) return undefined;
    const session = this.sessions.get(sid);
    if (!session) return undefined;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sid);
      return undefined;
    }
    return session.claims;
  }

  destroySession(sid: string | undefined): void {
    if (sid) this.sessions.delete(sid);
  }
}
