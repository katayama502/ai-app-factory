# ADR-007: App data isolation — per-app schema + role + enforced RLS

**Status:** Accepted
**Date:** 2026-08-21

## Context

Generated apps are, to varying degrees, untrusted. Two apps in the same organization must not be
able to read each other's rows, and a bug in one app's authorization logic must not become a
cross-app data leak.

## Decision

At publish time, each app gets its own PostgreSQL schema (`app_<appid>`) and its own login role
(`app_<appid>_rw`) with `search_path` locked to that schema and `public` revoked. Every table in
an app schema has Row Level Security **enabled and forced**. The connecting principal for a
request is propagated with `SET LOCAL factory.user_id / factory.department / factory.roles`
inside the transaction (never a persistent session variable), so RLS policies referencing
`current_setting('factory.*')` cannot leak across pooled connections. The app container itself
never receives DB credentials — only `sdk-gateway` holds them (see `02_SECURITY §7`).

## Consequences

- Authorization is enforced at three independent layers (API, SDK, DB) — a bug in any one layer
  does not by itself produce a breach (Defense in Depth, P4).
- `SET LOCAL` inside a transaction is required, not optional: it's the only mechanism that
  guarantees the principal is cleared when the transaction ends, even with connection pooling.
  This is verified directly by security test S-17.
- `access.rowLevel` cannot be a general expression language — see ADR-011.
