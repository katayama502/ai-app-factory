# Roadmap

Full milestone detail lives in
[`docs/design/04_IMPLEMENTATION_実装計画.md`](./docs/design/04_IMPLEMENTATION_実装計画.md). This
file tracks where we actually are.

## M0 — Foundation

Goal: ADRs settled, monorepo scaffold, CI running, `app-spec` v0 schema locked, setup token
protection + initial admin creation.

- [x] Monorepo scaffold (pnpm workspaces + Turborepo, shared `tsconfig.base.json`)
- [x] ADR-001 through ADR-012 written and accepted (`docs/adr/`)
- [x] `packages/app-spec` v0: Zod schema, validator, referential-integrity checks, canonical
      SHA-256 hashing — 19 passing tests
- [x] 3 hand-written sample Specs validated against the schema (`templates/`)
- [x] `packages/expr`: restricted expression parser + two compiler profiles (ADR-010 computed
      fields, ADR-011 rowLevel → RLS) — 25 passing tests
- [x] CI: lint / typecheck / test / build wired through Turborepo
- [x] README (EN primary + JA), LICENSE (Apache-2.0), NOTICE, CONTRIBUTING, SECURITY,
      CODE_OF_CONDUCT
- [ ] `docker-compose.yml` (postgres + valkey only) — scaffolded, not yet run end-to-end
- [ ] Setup token protection + initial admin creation (T-08) — **not started**; this is the one
      M0 item that blocks a public Alpha and must not slip to M6

## M1 — Walking Skeleton (in progress)

Goal: a hand-written Spec, with no AI involved, becomes a running app reachable in a browser.

- [x] `spec-compiler`: Spec → DDL (tables, computed `GENERATED` columns, FKs, indices),
      schema/role creation, RLS policy generation from `access.roles` + `access.rowLevel`,
      `SET LOCAL` principal propagation (ADR-007) — 21 unit tests + an 8-test integration suite
      that applies the compiled SQL to a **real PostgreSQL server** and proves RLS actually
      isolates rows across users/departments/roles (own-scope, dept-scope via the
      `department_of()` resolver function, fail-closed on a missing principal, DELETE rejected
      when no role grants it, Control Plane tables unreadable directly). Run locally via
      `pnpm --filter @aiappfactory/spec-compiler test:integration` — not yet wired into CI
      (needs a Postgres service container, tracked below).
  - Known simplification carried over from the design docs: `access` is one block shared by
    every entity in an app (not per-entity). A scoped grant (`:own`/`:dept`) whose rowLevel
    expression references a field that doesn't exist on a given entity is treated as
    inapplicable to *that* entity rather than a hard failure — see the `UnknownFieldError`
    handling in `spec-compiler/src/rls.ts` and the comment in `templates/meeting-room/app.yaml`.
  - Not yet built: diff-based re-migration for publishing a *new version* of an existing app
    (current `compileAppSpec` only handles first-publish DDL) — deferred, matches
    04_IMPLEMENTATION §8.4 ("DBマイグレーションのロールバックは自動化しない").
- [x] `company-sdk` + `sdk-gateway` minimal (database only — no `company.auth` yet, see below):
      `sdk-gateway` (Fastify) is the only process holding an app's DB role/pool and executes
      list/create/update/delete against the schema `spec-compiler` provisioned, propagating the
      caller's `{userId, department, roles}` via the same `SET LOCAL` pattern proven in
      spec-compiler's tests. `company-sdk` is a thin HTTP client over it — the only interface
      application code is meant to use to touch data (01_ARCHITECTURE §5.1). Also implements the
      two behaviors that make the SDK a *security* boundary, not just convenience (§5.3): `actor`
      fields are always set from the caller's `userId`, never from client-supplied data, and
      updating an `actor` field afterward is silently ignored. Cross-user access attempts surface
      as 404 (S-05 — hide existence, don't just deny), not 403. 8 unit tests (company-sdk 4,
      sdk-gateway 4) + a 10-test integration suite that drives the FULL path — Company SDK → HTTP →
      sdk-gateway → real Postgres RLS — over an actual `fastify.listen()` port, including actor
      auto-injection, unknown-field rejection (400), cross-user update (404), and delete rejected
      because no role in the Spec grants it (403). Run via
      `pnpm --filter @aiappfactory/sdk-gateway test:integration`.
  - `AppRegistry` is in-memory only — a real deployment reloads it from the Control Plane's
    `apps`/`app_versions` tables and `encrypted_secrets` (`packages/db`, not yet built). Whatever
    process registers an app today does so by calling `spec-compiler` and handing the resulting
    pool + schema name straight to the registry — there is no persistence yet.
  - `company.auth.currentUser()` (01_ARCHITECTURE §5.2) isn't implemented — no Keycloak yet
    (M4). `ExecutionContext` is currently just data the *caller* supplies; there is no session
    verification. Do not treat this as production-ready auth — it's a placeholder for the shape
    the real thing will have.
  - DELETE is a real SQL `DELETE`, gated by spec-compiler's `FOR DELETE` RLS policy — NOT the
    soft-delete (`deletedAt`) pattern the schema's column suggests. The `deletedAt` column exists
    on every table but isn't wired into any query yet; don't assume soft-delete works.
- [ ] `runtime/data`: the actual browser-facing REST API generated per Spec (currently only
      `sdk-gateway`'s internal API exists — nothing external-facing yet)
- [ ] `runtime/renderer`: Spec → form / list / dashboard UI (React)
- [ ] `deploy-engine`: register a Spec, per-app subdomain routing (ADR-012), health check
- [ ] Origin isolation (`__Host-` cookies, per-app CSP, COOP) + security test S-15
- [ ] Wire the spec-compiler and sdk-gateway integration suites into CI (needs a Postgres service
      container in `ci.yml`, plus deciding whether they stay Postgres-only or also run against
      `docker compose` for parity with the deploy target)

## Later milestones (unstarted)

| MS | Name | Goal |
|---|---|---|
| M2 | AI Builder | Natural language → Spec generation → preview → conversational editing |
| M3 | Security Gate | Gates 0/1/2/6/7/8/9 + Risk Engine + Auto Fix + approval flow |
| M4 | Identity & Store | Keycloak SSO, departments/roles, App Store |
| M5 | **v0.1 Public Alpha** | GitHub-public, third parties can run it via Compose |
| M6 | Operations | Setup Wizard, Doctor, monitoring, backup, updates |
| M7 | Polish & i18n | JA/EN UI, 10 templates, CSV/Excel import, docs site |
| M8 | **v0.5 Public Beta** | Pilots with 3 real companies |
| M9 | Hardening | Security tests S-01–S-18, external audit, T3 experimental |
| M10 | **v1.0 GA** | LTS begins, SBOM + signing, docs complete |
| M11 | Desktop | v1.1: Windows/macOS installers, offline bundle |

## Known risks actively being tracked

See `04_IMPLEMENTATION_実装計画.md §12` for the full risk register. The two decided in M0 that
were previously open:

- **R-13** (no production-quality JS CEL implementation) — resolved by
  [ADR-010](./docs/adr/010-t2-expression-language.md): a custom restricted AST evaluator in
  TypeScript, not a CEL/cel-go sidecar.
- **R-14** (`rowLevel` → RLS translation doesn't generally exist for a full expression language) —
  resolved by [ADR-011](./docs/adr/011-rowlevel-restricted-dsl.md): a schema-enforced restricted
  grammar, strictly narrower than the T2 expression language.
