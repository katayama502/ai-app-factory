import type { ExecutionContext } from "@aiappfactory/company-sdk";

/**
 * Stand-in for Keycloak (M4, ROADMAP.md) — 04_IMPLEMENTATION §11's own solo-dev
 * priority order says to substitute Basic Auth first and swap in real SSO later
 * ("認証は最初 Basic 認証で代替、Keycloak は後"). This directory is NOT an auth
 * system: it's a fixed, in-memory username→identity map with no password hashing,
 * no session/token issuance, no MFA. Do not deploy this outside local development.
 */
export interface DevUser {
  password: string;
  ctx: ExecutionContext;
}

export class DevUserDirectory {
  private readonly users = new Map<string, DevUser>();

  add(username: string, user: DevUser): void {
    this.users.set(username, user);
  }

  authenticate(username: string, password: string): ExecutionContext | null {
    const user = this.users.get(username);
    if (!user || user.password !== password) return null;
    return user.ctx;
  }
}
