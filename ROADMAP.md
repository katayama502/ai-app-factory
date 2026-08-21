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

## M1 — Walking Skeleton (complete)

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
- [x] `apps/runtime`: the browser-facing surface — both a REST API (`/api/:entity`, host-resolved —
      see origin isolation below) and a server-rendered HTML MVP of the Spec renderer (`form`/`list` page types only —
      `detail`/`dashboard`/`import` render a "not implemented" placeholder rather than silently
      doing nothing). Everything goes through `company-sdk`; this process holds no DB
      credentials. Auth is **HTTP Basic against an in-memory `DevUserDirectory`** — an explicit,
      documented stand-in for Keycloak (M4), not something to mistake for real auth. 16 unit
      tests (pure rendering functions) + an 8-test integration suite that drives the *entire*
      stack over real HTTP — browser-shaped requests → apps/runtime → company-sdk →
      sdk-gateway → real Postgres RLS — including submitting an HTML form and having the
      created record actually show up (RLS-scoped) in the list page. Run via
      `pnpm --filter @aiappfactory/runtime test:integration`.
  - **This closes M1's own Definition of Done**: a hand-written Spec (`sales-daily-report`),
    with no AI involved, is a running app reachable in a browser — register a report, see it in
    the list, search it, and have row-level access control hold for different logged-in users.
    Verified twice: by the automated integration suite above, and by hand in a real browser via
    `pnpm dev:sample` (see below) — alice sees only her own reports, bob (also `sales_member`)
    sees none of alice's, carol (`sales_manager`, same department) sees both.
  - **Two real bugs the manual browser check caught that the earlier all-HTTP integration test
    had not exercised**, both fixed and now regression-tested:
    1. Postgres `DATE` columns came back from `sdk-gateway` shifted by one day for any server
       process not running in UTC (node-postgres's default DATE parser builds a JS `Date` in
       the *server's local timezone*, which corrupts once JSON-serialized as UTC and read back
       elsewhere). Fixed in `services/sdk-gateway/src/pgTypes.ts` by not parsing DATE to a `Date`
       at all — it has no timezone to begin with, so the raw `"YYYY-MM-DD"` string is the
       correct representation. Regression-guarded in the runtime integration suite.
    2. All three integration suites (spec-compiler, sdk-gateway, runtime) reused the App Spec
       template's literal `metadata.id` verbatim, so they all derived the *same* schema/role
       names (ADR-007). Postgres roles are cluster-wide, not per-database — running any of them
       while `pnpm dev:sample`'s persistent dev role of the same name existed caused a
       `role already exists` failure. Fixed by having each integration suite mutate the parsed
       Spec's `id` to something unique-per-run before compiling, rather than tearing down
       anyone else's environment.
  - `scripts/dev-server.ts` (`pnpm dev:sample`) is a manual convenience script — NOT part of the
    shipped product, it's the human stand-in for `deploy-engine` (below). Boots BOTH the
    sales-daily-report and expense-request templates against a persistent local `aiaf_dev`
    database with three fixed dev users, each app served from its own `*.apps.localhost`
    hostname, so a person can actually click around at
    `http://sales-daily-report.apps.localhost:4200/pages/0` and
    `http://expense-request.apps.localhost:4200/pages/0`.
  - Not implemented in the renderer: `reference`-field `<select>` population is coded
    (`resolveReferenceOptions`) but neither manually verified nor covered by an automated test —
    the two templates demoed above (sales-daily-report, expense-request) have no reference
    fields; meeting-room does (`Reservation.room`) and would be the one to check it against. File
    uploads, edit-in-place from the list view, and the `detail`/`dashboard`/`import` page types
    are explicitly unbuilt, not silently missing (a `未対応` note renders in their place — verified
    live on expense-request's file field).
- [x] Per-app origin routing + isolation headers (ADR-012, S-15 — 04_IMPLEMENTATION E1-6/E1-9
      folded into `apps/runtime` rather than a separate Traefik-fronted `deploy-engine` process,
      since there's nothing yet to containerize per app): `RuntimeAppRegistry` maps hostname →
      app, resolved from `request.hostname` on every request — URL paths no longer carry an
      `appId` at all (`/pages/:index`, `/api/:entity`, host determines the app). An unregistered
      host is refused with 404 *before* auth is even attempted, so unknown hosts never see a
      credential prompt for an app that doesn't exist. Every response carries
      `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`,
      `Cross-Origin-Resource-Policy: same-origin`, and a CSP (`frame-ancestors 'none'`,
      `default-src 'self'`). `/healthz` is public (no auth) and reports the resolved app id —
      04_IMPLEMENTATION E1-6's health-check requirement, in the simplest form that means anything
      pre-deploy-engine. 20 unit tests (registry + header assertions) + 12 integration tests,
      including two DIFFERENT apps served by the SAME runtime process, distinguished only by
      hostname, verified over real HTTP against real Postgres.
  - Verified in a real browser (not just the automated suite): opened both apps'
    `*.apps.localhost` origins side by side via `pnpm dev:sample`, confirmed `location.origin`
    differs, and confirmed a same-page `fetch()` from one app's origin to the other's is REJECTED
    by the browser's own same-origin policy ("Failed to fetch") — the actual browser-enforced
    property ADR-012 exists for, not just a server-side header being present.
  - `*.apps.localhost` resolves to loopback automatically on macOS/Chrome (RFC 6761) — no
    `/etc/hosts` edit needed for local dev. Real deployments still need real DNS + a wildcard
    cert (`docs/design/02_SECURITY...md §7.4`), which is Setup Wizard's job (M6), not built.
  - What's still missing from ADR-012's full picture: real TLS (dev is plain HTTP — there are no
    cookies yet to make `Secure`/`__Host-` meaningful; that lands with the BFF pattern in M4),
    and `deploy-engine` itself — nothing here provisions DNS records, certs, or Traefik routes;
    `RuntimeAppRegistry` is populated by hand (or by `scripts/dev-server.ts`), not by a
    publish flow.
- [x] Wire the three integration suites (spec-compiler, sdk-gateway, runtime) into CI: a second
      `.github/workflows/ci.yml` job (`integration`) runs a `postgres:17` service container
      (`POSTGRES_HOST_AUTH_METHOD: trust`, mirroring the documented local dev setup) and runs all
      three `test:integration` scripts against it via `PG_TEST_SUPERUSER=postgres`. Verified
      locally before trusting it: created a throwaway local `postgres` superuser role (GitHub
      Actions' service default) and re-ran all three suites against it with the same env var the
      workflow sets, rather than assuming the YAML was correct. Not yet run against `docker
      compose` for parity with the actual deploy target — only a bare `postgres:17` image so far.

**M1 is functionally complete.** Every checkbox above is done; nothing on this milestone's own
Definition of Done is outstanding.

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
