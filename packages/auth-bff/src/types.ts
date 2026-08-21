/** What a resolved session yields — the shape `@aiappfactory/company-sdk`'s `ExecutionContext` expects, plus a display name. */
export interface SessionClaims {
  userId: string;
  department: string;
  roles: string[];
  name?: string;
}

export interface OidcAuthOptions {
  /** The realm's issuer URL, e.g. "http://localhost:8180/realms/factory". */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** Must exactly match a redirect URI registered on this client in Keycloak. */
  redirectUri: string;
  /** Session lifetime — independent of the Keycloak token's own expiry (ADR-006: access token 5m — we don't re-check with Keycloak on every request, so this is this BFF's own idle/absolute timeout). */
  sessionTtlSeconds?: number;
}
