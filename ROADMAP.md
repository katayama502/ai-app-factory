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
- [x] Setup token protection + initial admin creation (T-08): `packages/setup-guard`. A one-time
      token (generated server-side, only ever handed to the operator once, persisted only as a
      scrypt hash) gates a `/setup` endpoint that creates the real initial admin — via
      `@aiappfactory/keycloak-admin`, not a mock — then disables itself permanently, even for the
      original valid token. A loopback-only check (defense in depth beyond whatever the process's
      own bind address is) rejects any non-`127.0.0.1`/`::1` request before the token is even
      checked. If admin creation itself fails partway, setup deliberately stays open for a retry
      instead of permanently locking the operator out. 14 unit tests (Fastify `inject()`, including
      spoofed remote addresses) + a 2-test integration suite that completes setup against a real
      Keycloak and then actually logs in as the created account to confirm it's real and carries
      the right role — not just that the HTTP call returned 200. State is a single JSON file (a
      placeholder for a Control Plane DB row — `packages/db`, not built), so it survives a process
      restart before an operator gets to it. Not yet wired into any real service's boot sequence
      (there's no Console/Factory API process to mount it on yet) — it's a tested, reusable
      library today, not a running default-deny gate on anything.

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

## M2 — AI Builder (lightweight slice: Spec generation + self-repair; rest not started)

Goal per 04_IMPLEMENTATION §4: natural language → Spec generation, a Builder UI, preview,
conversational editing (template diff / JSON Patch), a requirement-elicitation multi-turn flow,
template vector search, and an evaluation set. Scoped down hard for a first pass — no UI, no
conversational editing, no multi-turn elicitation; just the core generate/validate/self-repair loop
(E2-6/E2-7), because everything else in this milestone is built *on top of* that loop rather than
alongside it.

- [x] `packages/app-spec`: `getAppSpecJsonSchema()` derives a JSON Schema from `appSpecSchema` via
      Zod v4's native `z.toJSONSchema()` — the same Zod schema that's already the single source of
      truth for `validateAppSpec`, not a second hand-maintained schema that could drift from it.
      This only needs to shape the model's *first* attempt; the business-logic constraints Zod's
      `superRefine` enforces (cross-field rules JSON Schema can't express) still run exclusively
      through `validateAppSpec` on every attempt, generated or hand-written alike. 3 unit tests
      (expected top-level keys, caching, JSON-serializability).
- [x] `packages/ai-core`: `generateAppSpec(description, provider, options?)` — the self-repair loop
      itself (E2-7: "検証エラー → 再生成、最大3回"). A model's output is NEVER trusted directly: every
      attempt, including repairs, goes through the exact same `validateAppSpec` a hand-written Spec
      does (this is Gate 0 — see `@aiappfactory/security-gate`, M3 above) before being accepted.
      A failed attempt's exact validation issues are fed back verbatim in the next prompt, alongside
      the full prior (invalid) attempt, so the model fixes a known-bad draft rather than re-rolling
      blind. After `maxAttempts` (default 3) failed attempts, returns the last set of issues instead
      of looping forever or silently accepting something invalid.
  - **`LlmProvider`**: a minimal abstraction (`generateStructured({systemPrompt, userPrompt,
    jsonSchema, toolName}) => Promise<unknown>`) so the retry loop's logic is provider-agnostic.
    `FakeProvider` is a deterministic test double (queued responses, call-history inspection) used
    for all of this milestone's own tests. `AnthropicProvider` is the real implementation — Claude's
    strict tool use (`strict: true` + a forced `tool_choice`) against the JSON Schema from
    `app-spec`, model defaults to `claude-opus-5`, checks for `stop_reason === "refusal"` before
    extracting the tool call. **Not exercised against a real Claude API call anywhere in this repo's
    test suite** — there is no `ANTHROPIC_API_KEY` in this development environment. `specGenerator`'s
    actual retry/validation logic is fully verified against `FakeProvider` instead (first-attempt
    success, recovery after an invalid first attempt with the repair prompt inspected via
    `callHistory()` to confirm it carries the prior attempt + issues, exhausting all attempts and
    returning `ok: false`, a custom `maxAttempts`) — 5 unit tests. `AnthropicProvider` is real,
    typechecked code ready for a key, not yet proven against the live API.
  - **`prompt.ts`**: the system prompt teaches grammar rules the JSON Schema alone can't express —
    naming conventions (kebab-case ids, PascalCase entities, camelCase fields, snake_case roles),
    the reserved-word list, the `actor` field's `system: true` requirement, the restricted
    `rowLevel` (ADR-011) and computed-field (ADR-010) expression grammars with worked examples, and
    the SSRF-relevant egress rule. Getting this prompt slightly wrong only costs an extra
    self-repair round-trip, not a safety gap — nothing it gets wrong can reach a compiled app
    without passing the same validator a hand-written Spec goes through.
- [ ] Builder UI (E2-8) — no UI at all; `generateAppSpec` is a library function today, nothing
      calls it from an HTTP endpoint or a browser
- [ ] Conversational editing via template diff / JSON Patch (E2-10) — not built; every generation
      is a fresh Spec, there's no "edit the existing one" flow
- [ ] Multi-turn requirement elicitation (E2-4) — not built; `generateAppSpec` takes one description
      string and produces one Spec, no clarifying-question round-trip
- [ ] Template vector search (E2-5) — not built; nothing retrieves a similar existing template to
      ground generation
- [ ] Evaluation set (E2-11) — not built; no fixture corpus of descriptions → expected Specs to
      regression-test generation quality against

## M3 — Security Gate (lightweight slice: Gate 0/2/6 + Risk Engine; rest not started)

Goal per 04_IMPLEMENTATION §5: Gates 0/1/2/6/7/8/9, a deterministic Risk Engine, Auto Fix, an
escalation UI, and a full approval flow. Scoped down hard for a first pass — no OPA/Rego, no
external scanner binaries, no AI Review, no dynamic sandbox execution; just what's cheap to run
in-process and still genuinely load-bearing for the T1/T2 tier this platform ships today.

- [x] `packages/risk-engine`: deterministic GREEN/YELLOW/RED scoring over a `Finding[]` (severity
      × point value, any CRITICAL or a cumulative score ≥100 forces RED, ≥10 forces YELLOW,
      `requiresApproval` forces at least YELLOW regardless of score) plus Ed25519 signing (ADR-008).
      The MEDIUM-severity cap on `source: "ai-review"` findings is enforced by *throwing* if a
      caller mistags one above MEDIUM — not a convention callers have to remember, a function that
      refuses to score a Spec that violates it. Signature verification deliberately takes the
      public key as a caller-supplied argument, never as a field on the signed payload itself — a
      payload that carries its own verification key proves nothing (anyone can re-sign with their
      own keypair and bundle their own key). 16 unit tests, including that a tampered verdict
      (RED silently rewritten to GREEN post-signing) fails verification.
- [x] `packages/security-gate`: runs Gate 0 (already *is* `@aiappfactory/app-spec`'s validator —
      the Constrained App Model, ADR-001, means most of what a traditional Gate 0 would need to
      check is already structurally unrepresentable in the grammar for T1/T2) as a hard block —
      an invalid Spec short-circuits straight to RED without running the other gates on garbage.
      A valid Spec proceeds through two new, cheap, in-process gates: Gate 2 (regex scan for
      accidentally-pasted credentials — AWS keys, private key blocks, GitHub/Slack tokens — over
      the Spec's raw source text, not the external `gitleaks` binary `security.yml` already
      references) and a Gate 6 heuristic (EN+JA PII keyword dictionary flagging a field that looks
      like personal data on an entity classified below PERSONAL — advisory, not a hard block:
      `requiresApproval: true` forces a human look rather than silently rejecting a possibly-wrong
      guess). Also accepts an `aiReviewFindings` array as the integration point for a future Gate 7,
      with the MEDIUM cap enforced by `risk-engine`, not re-implemented here. 14 unit tests,
      including that **every shipped template comes back GREEN with zero findings** (the
      04_IMPLEMENTATION §5 "正常Spec30件、誤検知ゼロ" fixture-testing spirit, in miniature) and that
      an SSRF-shaped internal-IP egress declaration comes back RED via Gate 0.
- [ ] Gate 1 (OPA/Rego policy engine), Gate 3/4/5 (Trivy/Opengrep — T3-only per 04_IMPLEMENTATION,
      not relevant while T3 doesn't exist), Gate 7 (actual AI Review — the integration point
      exists, nothing calls it yet), Gate 8 (dynamic egress observation — needs a running
      container to observe), Gate 9 (Spec → acceptance test generation) — none built
- [ ] Auto Fix loop, escalation UI, and the YELLOW → Approver → publish approval flow — none built;
      `security-gate` today returns a verdict, nothing acts on it
- [ ] The 20-dangerous/30-safe Spec fixture suite (04_IMPLEMENTATION §5 E3-13) — only a few
      illustrative cases exist as inline test fixtures, not the full regression suite
- [ ] Not wired into any publish flow — like `setup-guard`, this is tested reusable code with
      nothing calling it yet, since there's no deploy-engine/publish flow to call it from

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

## M5 — v0.1 Public Alpha (lightweight slice: infra Compose + one-command quickstart)

Goal per 04_IMPLEMENTATION: GitHub-public, third parties can run the whole thing via
`docker compose`. Scoped down hard for a first pass — the app processes (`sdk-gateway`,
`apps/runtime`) still run as host Node processes, not container images; only their
infrastructure dependencies (Postgres, Valkey, Keycloak) are containerized so far. This is
genuinely the harder half of M5 still undone, not a rounding error — see the last bullet.

- [x] `deploy/compose/docker-compose.yml` now provisions all three infra dependencies —
      Postgres (`pgvector/pgvector:pg17`), Valkey, and Keycloak (`quay.io/keycloak/keycloak:26.0`,
      `start-dev`) — with no weak default passwords baked in (`.env.example` requires the operator
      to set real ones, matching the file's existing OWASP A02 comment). `scripts/dev-server.ts`
      (`pnpm dev:sample`) now accepts `AIAF_PG_HOST`/`AIAF_PG_PORT`/`AIAF_PG_USER`/
      `AIAF_PG_PASSWORD`/`AIAF_KEYCLOAK_URL`/`AIAF_KEYCLOAK_ADMIN_PASSWORD` env vars — when
      `AIAF_KEYCLOAK_URL` is set, it trusts that Keycloak instance instead of self-managing its
      own `docker run` container, so it can point at the compose-provisioned one.
  - **Verified end to end, not just that the YAML parses**: brought the compose stack up on
    isolated host ports (to avoid colliding with this dev machine's own local Postgres on 5432),
    confirmed Postgres/Valkey report `healthy` and Keycloak's `/realms/master` responds, ran
    `pnpm dev:sample` against it with the new env vars, and confirmed both the realm/schema
    provisioning succeeded and an actual HTTP request to the runtime worked (`/healthz` → 200, an
    unauthenticated page request → 302 to `/auth/login`) — the same behavior as the self-managed
    local flow, just against compose-provisioned services instead. Torn down cleanly afterward
    (`docker compose down -v`), no state left behind.
- [x] **`scripts/quickstart.ts` (`pnpm start`)** — a one-command front door, added after actually
      trying to follow this repo's own setup instructions end to end and finding it still too many
      manual steps for a first-time reader (copy `.env.example`, hand-invent three passwords,
      `docker compose up`, then copy those same passwords into four env vars for `pnpm dev:sample`).
      `pnpm start` collapses all of that: checks Docker is running (clear EN+JA message and exit if
      not), generates `deploy/compose/.env` with random passwords ONLY if one doesn't already exist
      (never overwrites a reader's own), brings the stack up via `docker compose up -d --wait`
      (Postgres/Valkey have defined healthchecks; Keycloak doesn't, so it's polled separately, the
      same way `dev-server.ts`'s self-managed-Keycloak path already did), then spawns
      `pnpm dev:sample` with the `AIAF_*` env vars read back out of that `.env` file — the reader
      never copies a password between two places by hand. Idempotent: verified with two full runs
      back to back (fresh `.env` generation, then a second run that reused the existing `.env` and
      the already-provisioned realm/schema instead of redoing anything), both against a real,
      isolated-port compose stack, both ending in a working `/healthz` → 200 and the real
      `/auth/login` redirect. `GETTING_STARTED.md`/`GETTING_STARTED.ja.md` and both READMEs lead
      with this now; the fully manual env-var flow is kept as a documented "if you want more
      control" fallback, not removed.
- [ ] **`apps/runtime`/`sdk-gateway` are not packaged as container images** — this is the part of
      M5's own Definition of Done ("third parties can run it via Compose") that's still missing:
      today a third party needs Node + pnpm installed to run the app processes themselves, Compose
      only replaces the infra they'd otherwise install by hand. A Dockerfile (multi-stage pnpm
      monorepo build) plus wiring those services into `docker-compose.yml` is the next step here.
- [x] GitHub-public: the repo went public (`katayama502/ai-app-factory`) after the earlier decision
      to stay private until distributable; `pnpm start` above is what "distributable" concretely
      means today.
- [ ] No release process, versioning, or CHANGELOG — nothing has been tagged as a release

## M6 — Operations (lightweight slice: Installation Doctor only; rest not started)

Goal per 04_IMPLEMENTATION §19 (E6-2 etc.): Setup Wizard, Installation Doctor, monitoring, backup,
updates, rollback. Scoped down to the one piece that's cheap, self-contained, and immediately
useful before any of the rest exists: a pre-flight readiness check, matching
03_REPOSITORY's stated principle **"エラーが出たら次にすべきことを必ず出す"** (when something's wrong, always
show what to do next) — in Japanese, since that's who E6-2 explicitly calls out.

- [x] `scripts/doctor.ts` (`pnpm doctor`): checks Node/pnpm presence and version, whether Docker's
      daemon is reachable, total RAM, free disk space on the current volume, and whether the five
      ports this repo's dev flows bind (Postgres 5432, Valkey 6379, Keycloak 8180, sdk-gateway
      4100, runtime 4200) are free — printing a ✓/△/✗ per check and a Japanese remediation hint for
      anything that isn't clean. A port already in use is a warning, not a failure — `pnpm
      dev:sample` is designed to reuse an existing local Postgres/Keycloak rather than require the
      ports free, so treating that as fatal would be a false alarm on exactly the setup this repo's
      own dev flow expects. Verified by hand on this dev machine (correctly reports 5432 in use by
      the pre-existing local Postgres as a warning, everything else green) and via `tsx` directly
      to confirm output/exit-code behavior outside of pnpm's own log wrapping.
- [ ] Setup Wizard (web-based, one-time-token protected) — `packages/setup-guard` (M0) is the
      *backend* piece this would drive, but there's no web UI calling it
- [ ] Monitoring, backup, updates, rollback — none started; these need a running deployment to
      monitor/back up/update in the first place, which doesn't exist yet outside `pnpm dev:sample`

## M7 — Polish & i18n (lightweight slice: 2 more templates; rest not started)

Goal per 04_IMPLEMENTATION: JA/EN UI, 10 App Spec templates, CSV/Excel import, a docs site.
Scoped down to the cheapest, lowest-risk item — hand-authoring more templates costs nothing
structurally (each one is just validated by the same `validateAppSpec` and scored by the same
`security-gate` every other Spec is) and directly grows the "on-ramp for non-code contributions"
the repo layout already calls `templates/` out as.

- [x] Two new App Spec templates, bringing the total from 3 to 5 (still short of the "10
      templates" goal — see below): **`templates/it-equipment-request`** (IT機器貸与申請) —
      deliberately uses an *unscoped* admin role (`it_admin` gets plain `read`/`update`/`export`,
      no `:dept` grant) rather than every other template's department-scoped approver, since IT
      support legitimately needs to see every department's requests; and
      **`templates/vacation-request`** (休暇申請) — a department-scoped approval flow like
      `expense-request`'s, but a different domain (date-range leave requests, `CONFIDENTIAL`
      classification since a leave reason like "病欠" can reveal health information). Both pass
      `app-spec`'s validator and come back GREEN with zero `security-gate` findings — the two test
      suites that walk `templates/` dynamically (`packages/app-spec/test/templates.test.ts`,
      `packages/security-gate/test/evaluateSpec.test.ts`) picked them up with no test-file changes
      needed, and now cover 5 templates instead of 3.
- [ ] 8 more templates needed to reach the "10 templates" goal
- [ ] JA/EN UI — there is no Builder/Console UI to localize yet (that's M2's unbuilt E2-8); the
      *rendered app pages* (`apps/runtime`'s form/list/detail HTML) are effectively JA-first today
      because every shipped template's labels are Japanese, but nothing about the renderer itself
      is locale-aware — it just prints whatever string the Spec's `label` field contains
- [ ] CSV/Excel import — `ui.pages` already has an `import` page *type* in the schema
      (`sales-daily-report` uses one) but `apps/runtime`'s renderer treats `import` as an
      unimplemented placeholder (see M1's entry above); no parsing/dry-run logic exists
- [ ] Docs site — `docs/` is markdown-only, no generated site/search

## M8 — v0.5 Public Beta (deliberately not attempted)

Goal per 04_IMPLEMENTATION: pilots with 3 real companies (explicitly including at least one
"IT-staff-less SME" — the platform's actual target user), measuring setup completion rate, time to
first published app, drop-off points, and regeneration counts, to set M9's priorities.

- [ ] **Everything in M8 is a real-company pilot program** — by explicit instruction, this was not
      attempted in this session ("日企業でのパイロット試験は無しでOKです"). There is no code-shaped
      subset of M8 to build: its entire Definition of Done is running actual pilots with actual
      companies and collecting actual usage data, none of which a coding session can substitute for
      or fake convincingly. Nothing else in 04_IMPLEMENTATION's M8 section exists beyond this.

## M9 — Hardening (lightweight slice: S-01~S-18 traceability + 2 new tests + ARCHIVED cleanup)

Goal per 04_IMPLEMENTATION E9-1~E9-9: full automation of security tests S-01–S-18, 300-user
performance testing, external penetration testing, fault injection, T3 experimental (Deno sandbox
+ Gate 3/4/5/8), upgrade testing, ARCHIVED resource cleanup, and pilot-driven UI polish. Scoped
down to what's genuinely buildable without pilots, an external auditor, or unbuilt subsystems
(T3, an audit log, a container-per-app runtime, Gate 9) — see the traceability table below for
exactly which of S-01–S-18 that leaves testable today.

- [x] **S-01–S-18 traceability** (E9-1's spirit: "完全自動化" starts with knowing what's actually
      covered). None of these are new tests for their own sake — most were already running in CI
      from earlier milestones and simply hadn't been cataloged against the threat model's own
      numbering:

  | # | Threat | Status | Where |
  |---|---|---|---|
  | S-01 | Cross-tenant read via SDK token | ⚠ Partial | No per-app SDK *token* auth exists yet (sdk-gateway is called host-internally, not via a bearer token an attacker could hold) — but app-to-app isolation at the session/origin layer is tested: `apps/runtime/test/integration/browser-flow.pg.test.ts` ("app A and app B are genuinely different OIDC clients", "a session cookie minted by app A's login is meaningless on app B") |
  | S-02 | RLS bypass via direct SQL | ✅ | `packages/spec-compiler/test/integration/rls.pg.test.ts` — connects with the app's own low-privilege role and confirms RLS still applies, and that Control Plane tables aren't directly readable |
  | S-03 | Egress to an undeclared host | ❌ Not built | No `deploy-engine`/per-app network sandbox exists to enforce this against yet — `network.egress` is schema-validated (SSRF-shaped hosts rejected at Gate 0) but nothing runtime-enforces "only declared hosts" |
  | S-04 | App reaches Control Plane/Keycloak/DB directly | ❌ Not built | Same — needs per-app network isolation, which needs containerization (M5's other, unbuilt half) |
  | S-05 | IDOR (404, not 403) | ✅ | `services/sdk-gateway/test/integration/http.pg.test.ts` — explicitly tagged in the test name |
  | S-06 | Privilege escalation to an Admin API | ❌ N/A | No Admin API exists yet to escalate to; the closest analog (a role attempting a grant it doesn't hold) is covered under general authorization tests, not this specific threat |
  | S-07 | Secret detection → RED | ✅ | `packages/security-gate/test/evaluateSpec.test.ts` — "Gate 2 (secrets)" describe block |
  | S-08 | Fail-closed on scanner crash → RED | ✅ **New this milestone** | `evaluateSpec.ts` now catches a gate throwing and returns RED with a CRITICAL `gate-crash` finding instead of letting the exception escape uncaught; test in the same file |
  | S-09 | Signed verdict tamper detection | ✅ | `packages/risk-engine/test/signing.test.ts` |
  | S-10 | Audit log tamper detection | ❌ Not built | `packages/audit` doesn't exist yet |
  | S-11 | Setup protection (no token → 403) | ✅ | `packages/setup-guard/test/routes.test.ts` + its integration suite |
  | S-12 | Prompt injection blocked by Spec validation | ✅ **New this milestone** | `packages/ai-core/test/specGenerator.test.ts` — a model output shaped by a prompt-injection attempt (SSRF-shaped egress) is rejected exactly like any other invalid attempt, across all retries |
  | S-13 | PERSONAL data blocks external LLM routing | ❌ Not built | No classification-aware LLM routing exists (`ai.features`'s `policy.allowExternal` is schema-only, nothing reads it at call time) |
  | S-14 | Generated-app container hardening | ❌ Not built | No per-app container exists to harden |
  | S-15 | Origin isolation | ✅ | `apps/runtime/test/integration/browser-flow.pg.test.ts` — "every response carries the origin-isolation headers" + confirmed by hand in a real browser (see M1's entry above) |
  | S-16 | DB credentials never distributed to the app process | ✅ **New this milestone** | `apps/runtime/test/noDbCredentials.test.ts` — structural test: neither `apps/runtime` nor `company-sdk` depends on `pg` in production, or imports it anywhere in `src/` |
  | S-17 | RLS principal doesn't leak between requests on a pooled connection | ✅ | `packages/spec-compiler/test/integration/rls.pg.test.ts` — "fail-closed: no factory.roles set at all", plus every per-user test in that suite runs against the SAME pool, proving `SET LOCAL` scoping holds across consecutive different-user transactions |
  | S-18 | Gate 9 detects `access.roles` vs. actual-behavior mismatch | ❌ Not built | Gate 9 (acceptance-test generation from a Spec) doesn't exist |

  **9 of 18 covered (or partially covered), 9 blocked on unbuilt subsystems** — T3 sandboxing
  (S-03/S-04/S-14), an audit log (S-10), classification-aware LLM routing (S-13), a real Admin API
  (S-06), and Gate 9 (S-18). None of these were faked or approximated to inflate the count.
- [x] E9-8 — **ARCHIVED resource cleanup**: `archiveApp(pool, schemaName, roleName)`
      (`packages/spec-compiler`) reverses `compileAppSpec`'s provisioning — drops the schema
      (`CASCADE`, taking every table/policy with it) and the role (`DROP OWNED BY` first, to
      release the resolver-function `EXECUTE` grants, then `DROP ROLE`). Idempotent by checking
      existence first (`DROP OWNED BY` has no `IF EXISTS` form and errors on a role that's already
      gone). `deleteClient`/`deleteRealmRole` (`packages/keycloak-admin`) do the same for the OIDC
      client and realm roles a Spec's `access.roles` provisioned. Verified against a real Postgres
      server (provision → confirm exists → archive → confirm gone → archive again → confirm the
      second call is a no-op, not an error) — 3 integration tests. `keycloak-admin`'s two functions
      are unit-tested with mocked fetch (matching that package's existing test style; a live-Keycloak
      integration suite for delete would be redundant with the create-side coverage `auth-bff`/
      `setup-guard` already have against the same API surface).
  - Not wired into any actual "archive this app" flow — like the rest of M9, this is tested,
    reusable code with nothing calling it yet, since there's no App Store/admin UI to trigger an
    archive action from
- [ ] E9-2 performance testing (50 apps / 300 users), E9-3 external security audit, E9-4 fault
      injection (DB/AI-API/disk/scanner down), E9-5 T3 experimental, E9-6 upgrade testing (no
      version has ever been tagged, so "v0.1 → v0.5 → v1.0 migration" has nothing to migrate
      between yet), E9-7 Tauri PoC (folded into M11 below), E9-9 pilot-driven UI polish (blocked on
      M8) — none attempted; each either needs infrastructure/tooling well beyond this session's
      scope (a real pentest, a 300-user load rig) or a prerequisite this repo doesn't have yet

## M10 — v1.0 GA (lightweight slice: SBOM generation; rest is a business decision, not code)

Goal per 04_IMPLEMENTATION: begin an LTS policy with a 12-month security-support declaration,
publish compliance documentation (personal data handling, data residency, external transmission
disclosure), SBOM + signing, and at least 2 published case studies.

- [x] `scripts/sbom.ts` (`pnpm sbom`, or `pnpm sbom -- --stdout`): generates a CycloneDX 1.5 JSON
      SBOM covering every workspace package (12, as first-party `application` components) and
      every resolved third-party npm dependency — direct and transitive, deduplicated by
      name@version — as `library` components, with each one's REAL license read from its own
      installed `package.json` (not guessed or omitted). Sourced from `pnpm list -r --json
      --depth=Infinity` (pnpm's own authoritative resolution) rather than a hand-parse of
      `pnpm-lock.yaml`, which would just be a second, driftable copy of the same data. Verified by
      running it for real: 12 workspace packages + 354 unique third-party dependencies, 277 of
      which had a real license recorded. Wired into CI (`.github/workflows/ci.yml`) as a build
      artifact on every run, not just a command that exists but nobody runs.
- [ ] Signing — nothing to sign yet. There's no release artifact (no container image from M5, no
      tagged version) for a signature to attach meaningful provenance to; building a signing step
      ahead of having something real to sign would just be theater
- [ ] LTS policy, 12-month security-support declaration, compliance documentation, case studies,
      an actual v1.0 tag — **these are business/organizational decisions about a real, public
      commitment, not implementation tasks a coding session can responsibly make on the repo
      owner's behalf.** This repo is still private by earlier explicit decision (see the M0–M4
      history above) and has not shipped a single tagged release; declaring "v1.0 GA" or "LTS"
      over it would be dishonest regardless of how much lightweight code exists underneath

## M11 — Desktop (not attempted — see reasoning)

Goal per 04_IMPLEMENTATION: v1.1, Windows/macOS installers, an offline bundle. Even
04_IMPLEMENTATION's own 1-person-team prioritization (§11) scopes the *relevant* M9 item (E9-7) to
"Tauri ランチャーの技術検証（v1.1 に向けた PoC のみ）" — a technical proof-of-concept, not a shipped
installer — and that's for the milestone BEFORE this one.

- [ ] Not attempted. Three reasons, not just one: (1) this session can build and run on macOS
      (this dev machine) but has no way to build *or test* a Windows installer at all; (2) a real
      installer needs to bundle/manage Postgres + Keycloak + Node for a non-technical end user,
      which is a substantial undertaking in its own right, not a thin wrapper around
      `pnpm dev:sample`; (3) producing something that merely *looks* like an installer without
      being verified to actually install and run correctly would be worse than not having one —
      a broken installer actively costs a non-engineer user's trust in a way "not built yet" does
      not. Given M8 (real users) and M9's harder items (external audit, T3) are also not done, an
      installer for a product that isn't yet hardened or piloted would be premature regardless.

## Known risks actively being tracked

See `04_IMPLEMENTATION_実装計画.md §12` for the full risk register. The two decided in M0 that
were previously open:

- **R-13** (no production-quality JS CEL implementation) — resolved by
  [ADR-010](./docs/adr/010-t2-expression-language.md): a custom restricted AST evaluator in
  TypeScript, not a CEL/cel-go sidecar.
- **R-14** (`rowLevel` → RLS translation doesn't generally exist for a full expression language) —
  resolved by [ADR-011](./docs/adr/011-rowlevel-restricted-dsl.md): a schema-enforced restricted
  grammar, strictly narrower than the T2 expression language.
