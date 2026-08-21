# ADR-003: License — Apache-2.0 with DCO

**Status:** Accepted
**Date:** 2026-08-21

## Context

For an enterprise self-hosted product, the license of the *core* determines whether a company's
legal team lets anyone evaluate it at all. It also has to interoperate with the licenses of
everything we depend on (Keycloak, Trivy, OPA, Traefik are all Apache-2.0 or compatible).

## Decision

The core (`ai-app-factory` monorepo) is Apache-2.0. Contributions are accepted under a Developer
Certificate of Origin (`git commit -s`), not a CLA. Enterprise add-ons (SSO extensions, HA,
SIEM connectors) ship from a **separate repository under a separate, commercial license** — this
boundary is fixed at v0.1 and stated in the README so it cannot be moved later without visibly
breaking a public promise.

## Consequences

- Lowest legal friction for corporate adoption; consistent with the dependency graph.
- DCO has a lower contribution barrier than a CLA, at the cost of not being able to dual-license
  the core later without re-collecting rights — accepted, since dual-licensing was never the plan.
- The Apache-2.0/Enterprise boundary must be enforced by *not writing Enterprise-only code paths
  into the core repo*, not by a runtime flag — see `03_REPOSITORY §3.2`.
- A `NOTICE` file and CI-enforced denylist (AGPL / SSPL / Sustainable Use License / BSL) keep
  transitively-incompatible dependencies out (see `deploy/`, `.github/workflows/security.yml`).
