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
  - `company.auth.currentUser()` (01_ARCHITECTURE §5.2) — the SDK-level accessor — still isn't
    implemented, but the identity it would return now comes from a real Keycloak session
    (`packages/auth-bff`, M4 below) rather than caller-supplied data.
  - DELETE is a real SQL `DELETE`, gated by spec-compiler's `FOR DELETE` RLS policy — NOT the
    soft-delete (`deletedAt`) pattern the schema's column suggests. The `deletedAt` column exists
    on every table but isn't wired into any query yet; don't assume soft-delete works.
- [x] `apps/runtime`: the browser-facing surface — both a REST API (`/api/:entity`, host-resolved —
      see origin isolation below) and a server-rendered HTML MVP of the Spec renderer (`form`/`list` page types only —
      `detail`/`dashboard`/`import` render a "not implemented" placeholder rather than silently
      doing nothing). Everything goes through `company-sdk`; this process holds no DB
      credentials. Auth was originally an HTTP-Basic `DevUserDirectory` placeholder — **since
      replaced by real Keycloak login** (`packages/auth-bff`, see M4 below); nothing in this repo
      still uses Basic Auth. 20 unit tests (pure rendering functions + registry/header
      assertions) + a 9-test integration suite that drives the *entire* stack over real HTTP —
      browser-shaped requests → apps/runtime → company-sdk → sdk-gateway → real Postgres RLS,
      gated by an actual Keycloak login form → including submitting an HTML form and having the
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
  - What's still missing from ADR-012's full picture: real TLS — dev is plain HTTP, so the
    session cookie `packages/auth-bff` now issues (see M4) runs in its non-`Secure`,
    non-`__Host-`-prefixed mode (the code picks the stronger variant automatically once a
    request actually arrives over HTTPS — see `cookies.ts` — nothing to redo, just nothing
    exercising that path yet); and `deploy-engine` itself — nothing here provisions DNS records,
    certs, or Traefik routes; `RuntimeAppRegistry` is populated by hand (or by
    `scripts/dev-server.ts`), not by a publish flow.
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

## M4 — Identity & Store (Keycloak login slice done; rest not started)

Goal per 04_IMPLEMENTATION §6: Keycloak integration, user/department/role management UI, Spec
`access` → Keycloak role sync, App Store, one-click publish flow, audit log. Jumped ahead of M2/M3
because the M1 walking skeleton's placeholder auth (`DevUserDirectory`, Basic Auth) was the
one piece least honest to leave in place — everything else below is still genuinely unstarted.

- [x] Keycloak login (04_IMPLEMENTATION E4-1's core): Authorization Code + PKCE, BFF pattern
      (ADR-006) — the browser holds only an httpOnly session cookie, never a token.
  - **`packages/keycloak-admin`**: realm/client/role/user provisioning over Keycloak's Admin
    REST API. Not a general-purpose SDK — just what ADR-006 needs. Encodes three real gotchas
    found by provisioning against an actual Keycloak instance (not guessed from docs): (1)
    Keycloak 26's declarative User Profile silently *drops* any custom attribute (like
    `department`) not declared in its schema — `unmanagedAttributePolicy: "ENABLED"` fixes it,
    but the failure mode without it is silence, not an error; (2) the built-in "realm roles"
    mapper defaults to `id.token.claim=false`, so `realm_access.roles` is in the access token
    but NOT the ID token unless a dedicated client-level mapper is added; (3) creating a user
    without `email`/`firstName`/`lastName` produces a working-looking 201/204 chain that only
    fails later, opaquely, as `invalid_grant: "Account is not fully set up"` on first login.
    4 unit tests (mocked fetch).
  - **`packages/auth-bff`**: the OIDC logic itself, via `openid-client` v6. Deliberately does
    NOT register Fastify routes — a Runtime process hosts MULTIPLE apps behind ONE set of
    `/auth/login`, `/auth/callback`, `/auth/logout` paths (ADR-012), so route registration
    happens once in `apps/runtime`, dispatching to whichever app's `OidcAuth` instance the
    resolved Host maps to (one `OidcAuth` per app — ADR-006: each app is its own OIDC client).
    Session store and PKCE/state "pending login" store are both in-memory `Map`s — correct for
    one process, NOT for a horizontally-scaled deployment (needs Valkey — 01_ARCHITECTURE
    §2.1 — before running more than one Runtime replica; tracked here, not solved). 16 unit
    tests (cookies + session store) + a 5-test integration suite that drives the *entire* flow
    against a real, freshly-provisioned Keycloak: follows the redirect to Keycloak's own hosted
    login page, parses and submits its actual HTML login form, follows the callback, and checks
    the resulting session — including a wrong password never reaching the callback, a replayed
    callback URL failing the second time (state is one-shot), and logout actually clearing the
    session. Run via `pnpm --filter @aiappfactory/auth-bff test:integration` — spins up its own
    throwaway `quay.io/keycloak/keycloak` container via Docker.
  - **`apps/runtime`**: `DevUserDirectory`/Basic Auth removed entirely (see M1's entry above,
    already updated to reflect this — not left in place as a fallback). Unauthenticated HTML
    page requests redirect to `/auth/login?returnTo=<original path>`; unauthenticated `/api/*`
    requests get 401 JSON instead of a redirect a `fetch()` call can't usefully follow.
    Discovered and fixed one real bug building this: constructing the callback URL from
    `request.hostname` (which strips the port) instead of `request.headers.host` silently broke
    every login, because `openid-client` derives the `redirect_uri` it sends to the token
    endpoint from that URL's origin, and Keycloak rejects a mismatched one — the failure surfaced
    as an opaque `token exchange failed`, not an obviously-a-port-bug error.
  - `scripts/dev-server.ts` now provisions a real, *persistent* local Keycloak dev container
    (`aiaf-dev-keycloak`, reused across re-runs like the `aiaf_dev` Postgres database already
    was) with realm `factory-dev`, roles for both demo templates, and alice/bob/carol as real
    Keycloak users. Verified live in a real browser, not just the automated suite: navigated to
    the app, got redirected to Keycloak's actual hosted login page, signed in as alice, landed
    back on the form, submitted a report, saw it in the RLS-scoped list with the correct date.
    Also confirmed (and left as documented, intentional behavior, not a bug): visiting
    `/auth/logout` clears *this app's* session but Keycloak's own SSO session cookie is still
    live, so the very next `/auth/login` redirect silently re-authenticates without prompting —
    a full cross-app SSO logout would need `end_session_endpoint` plumbing, not built.
  - [x] Wired into CI alongside the Postgres-backed suites — `auth-bff`'s and `runtime`'s
        integration tests manage their own throwaway Keycloak container via the Docker CLI
        directly (GitHub-hosted `ubuntu-latest` runners have Docker by default), so no
        `services:` entry was needed for it, unlike Postgres.
- [ ] `company.auth.currentUser()` — expose the now-real session identity through Company SDK
      itself, not just apps/runtime's own request context
- [ ] User/department/role management UI (E4-2)
- [ ] Spec `access` → Keycloak client role sync (E4-3) — roles are provisioned by hand
      (`scripts/dev-server.ts`, or a test's own setup) today, not derived from a Spec's
      `access.roles` automatically
- [ ] App Store (E4-5), one-click publish flow (E4-6), audit log (E4-7) — none started
- [ ] Realm/org provisioning is manual (`createRealm` called once by hand) — no
      "new organization signs up → realm created automatically" flow

## Later milestones (unstarted)

| MS | Name | Goal |
|---|---|---|
| M2 | AI Builder | Natural language → Spec generation → preview → conversational editing |
| M3 | Security Gate | Gates 0/1/2/6/7/8/9 + Risk Engine + Auto Fix + approval flow |
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
