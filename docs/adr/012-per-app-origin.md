# ADR-012: Every app gets its own origin — subdomain, not a path

**Status:** Accepted
**Date:** 2026-08-21

## Context

Network-level isolation between apps (deny-by-default egress, per-app DB schema) says nothing
about what happens *inside a shared browser tab context*. If all apps are served from the same
origin under different paths (`console.company.com/apps/<slug>`), app A's JavaScript can reach
app B's DOM, `localStorage`, and cookies — the browser has no concept of a "path boundary" for
same-origin policy. Since generated apps are explicitly untrusted code, this is the single largest
hole in an otherwise carefully isolated design (T-02b).

Path-based isolation also conflicts with the original concept's goal of hiding infrastructure
concepts (Docker, ports, hostnames) from non-engineer users — but hiding the *hostname* is not
actually required to hide Docker; only hiding the *port and protocol detail* is.

## Decision

Every app is served from its own subdomain: `<slug>.apps.<company-domain>`, distinct from
`console.<company-domain>`. Cookies use the `__Host-` prefix (no domain sharing with a parent
domain). Each app gets its own CSP (`default-src 'self'`, `frame-ancestors 'none'`,
`connect-src` limited to the SDK Gateway only), plus `COOP: same-origin` and
`CORP: same-origin`. A wildcard certificate (`*.apps.<company-domain>`) covers all app
subdomains. Because this requires a real DNS name, `.local` is explicitly disallowed as a default
hostname (RFC 6762 reserves it for mDNS; public CAs will not issue certificates for it) — see
`02_SECURITY §9` and `07.4` in the architecture doc for the CA options this implies.

## Consequences

- Origin isolation is enforced by the browser itself, not by application code that could have a
  bug — this is the strongest layer available for T-02b, verified directly by security test S-15.
- Every app publish must provision a real DNS entry (or wildcard match) and a valid TLS cert
  before the app is reachable — this is why Setup Wizard's TLS step (social CA vs. Let's Encrypt
  DNS-01 vs. localhost-only) exists as a first-class, not optional, step (`02_SECURITY §10`).
- This must be decided before M1, not retrofitted later: changing an app's serving origin after
  the fact changes every URL a user has bookmarked or embedded, which is effectively a breaking
  migration for every app on the platform (`04_IMPLEMENTATION §11`, R-15).
