# ADR-006: Authentication — Keycloak + BFF pattern, no tokens in the browser

**Status:** Accepted
**Date:** 2026-08-21

## Context

We need SSO, department/role modeling, and per-app OIDC clients, and we need it to be an OSS
component we can bundle (Apache-2.0). We also need to avoid putting bearer tokens in browser
JS reach, since generated apps are explicitly untrusted code sharing the browser with Control
Plane UI in the worst case of a misconfiguration.

## Decision

Keycloak is the IdP, single realm `factory`, organizations modeled as realm group hierarchies.
Authorization Code + PKCE only (no implicit flow). The browser never holds an access/refresh
token: Next.js Console and App Runtime act as a BFF, storing tokens server-side and issuing the
browser an `httpOnly; Secure; SameSite=Lax`, `__Host-`-prefixed session cookie.

## Consequences

- XSS in a generated app cannot steal a reusable bearer token, because there isn't one to steal
  client-side — this composes with ADR-012 (per-app origin) as defense in depth.
- Every BFF (Console, App Runtime × N) needs its own OIDC client and session store; this is more
  moving parts than a SPA-with-token design, accepted as the cost of the security property.
- MFA (TOTP) is enforced for the Admin role by default (`02_SECURITY §9`).
