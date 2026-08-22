# AI App Factory — Community Edition

**Let non-engineers build internal business apps with AI — without letting AI write code that
runs in your production environment.**

[日本語 README](./README.ja.md) · [Architecture](./docs/) · [Roadmap](./ROADMAP.md) · [Security Model](./SECURITY.md)

**New here, or not a developer?** Start with **[GETTING_STARTED.md](./GETTING_STARTED.md)** — a
plain-language, step-by-step guide with no assumed background. This README is the technical
reference; that guide is the on-ramp.

> **Status: M1 "Walking Skeleton" complete, plus M4's real-auth slice, plus lightweight
> M0/M2/M3/M5/M6/M7/M9/M10 slices.** A hand-written App Spec, with no AI involved, compiles to an
> isolated Postgres schema and is reachable as a real app in a browser — gated by an actual
> Keycloak login (Authorization Code + PKCE, BFF pattern), not a dev placeholder: register a
> record via an HTML form, see it in a list, search it, and have row-level access control hold for
> different logged-in users. A natural-language description can also generate that same kind of
> Spec through an actual web UI now (`apps/console`, M2's Builder UI slice) — describe an app,
> watch it get generated, scored by a deterministic signed GREEN/YELLOW/RED Security Gate (M3's
> Gate 0/2/6 slice), and — if it isn't RED — published into a real, live, loggable-into app, no
> restart needed. Generation itself is still only tested against a fake/offline model, not a live
> Claude API call (plug in `ANTHROPIC_API_KEY` and the same UI switches to real generation — the
> code path is wired and typechecked, just not exercised against the live API in this dev
> environment). The infra a third party needs (Postgres/Valkey/Keycloak) now boots via
> `docker compose`, and a single `pnpm start` automates the whole setup — passwords, waiting for
> readiness, launching the demo and the Builder UI — with nothing to hand-edit (M5's infra slice;
> the app processes themselves still run as host Node commands, not container images), a
> `pnpm doctor` pre-flight check reports what's missing with Japanese remediation hints (M6's
> slice), and 5 of a planned 10 App Spec templates exist (M7's slice). Against the security threat
> model's own S-01–S-18 numbering, 9 are covered (traced to their tests, 3 newly added) and 9 are
> honestly marked not-yet-applicable — no unbuilt feature (M9's slice); archiving an app now
> actually tears down its Postgres schema/role and Keycloak client/roles, verified against real
> servers (also M9); and `pnpm sbom` generates a real CycloneDX SBOM from the actual resolved
> dependency tree, wired into CI (M10's slice — signing and an actual GA release remain undone,
> since there's nothing to sign yet and declaring GA is a business decision, not a coding task).
> M8 (real-company pilots) and M11 (desktop installers) were deliberately not attempted — see
> ROADMAP.md for why. This is still a single-operator local dev/demo experience, not an
> authenticated multi-tenant product (that's M4's much larger, unbuilt Console/App Store) — but
> the "describe → generate → publish → use" loop itself is real, not a mock.
> See [ROADMAP.md](./ROADMAP.md) for the exact state.

## The idea, in one sentence

Instead of letting an LLM write and deploy arbitrary application code, AI App Factory has the AI
emit a **declarative, schema-validated Spec** (entities, forms, dashboards, permissions,
automations) which a shared, pre-built **App Runtime** interprets. There is no code path for the
AI to write `eval`, raw SQL, or an unrestricted network call — not because a scanner catches it
after the fact, but because the Spec grammar has no way to express it in the first place.

```
natural language  →  App Spec (YAML/JSON, schema-validated)  →  App Runtime interprets it
```

This is the difference between "scan generated code and hope" and "make the dangerous thing
unrepresentable." See [`docs/adr/001-constrained-app-model.md`](./docs/adr/001-constrained-app-model.md).

## Why this exists

Non-engineers in a company (sales, admin, HR) constantly need small internal tools — a daily
report form, an expense request flow, a meeting-room booking board — and today either wait weeks
for IT, or reach for a spreadsheet that becomes unmaintainable. Existing "AI builds your app"
tools either don't take self-hosting/security seriously, or don't take non-engineers seriously.
This project tries to take both seriously at once. The full design rationale (and the parts of the
original 89-point concept that were deliberately cut or changed for v1.0) is in
[`01_ARCHITECTURE_全体設計書.md`](./docs/design/01_ARCHITECTURE_全体設計書.md) and
[`02_SECURITY_セキュリティ設計書.md`](./docs/design/02_SECURITY_セキュリティ設計書.md).

## Design principles

| Principle | Meaning |
|---|---|
| Structural over Detective | Prefer "the app literally cannot declare this" to "a scanner might catch this" |
| Fail Closed | A scanner crash or an unresolvable check blocks publish; it never waves it through |
| AI Never Approves | AI review can only *add* risk findings, capped at MEDIUM severity — it can never clear a hard-block or be the reason something is marked safe |
| Defense in Depth | The same rule (e.g. "you can only see your own rows") is enforced at the API, SDK, *and* database layer independently |
| Everything is Audited | Every action lands in an append-only, hash-chained audit log |
| Secure Defaults | Every default value is the safe one; loosening anything requires explicit admin consent + an audit record |

## Repository layout

```
apps/console/           Next.js — Builder UI / App Store / Admin / Setup Wizard (not started)
apps/runtime/           Browser-facing REST API + a server-rendered HTML MVP of the Spec renderer (React version not started)
services/sdk-gateway/   The only process holding app DB credentials — executes CRUD, enforces RLS's principal
services/...            Factory API, AI Gateway, AI Orchestrator, Security Gate, Deploy Engine (not started)
packages/app-spec/      ★ The Spec schema, validator, and canonical hashing — the foundation everything else builds on
packages/expr/          Restricted expression parser + compiler (ADR-010 computed fields, ADR-011 rowLevel → RLS)
packages/spec-compiler/ Spec → PostgreSQL DDL/RLS (ADR-007) — includes a real-Postgres integration test suite
packages/company-sdk/   The only API app code may use to touch data — an HTTP client over sdk-gateway
packages/auth-bff/      OIDC Authorization Code + PKCE, BFF pattern (ADR-006) — real Keycloak login, no tokens in the browser
packages/keycloak-admin/ Realm/client/role/user provisioning over Keycloak's Admin REST API
packages/setup-guard/   One-time token gate for initial admin creation (T-08) — real Keycloak, self-disabling
packages/risk-engine/   Deterministic GREEN/YELLOW/RED scoring + Ed25519 signing (ADR-008)
packages/security-gate/ Gate 0/2/6 (structural validation, secret scan, PII heuristic) — Gates 1/3-5/7-9 not started
packages/ai-core/       Natural language → App Spec via a validate/self-repair loop (E2-6/E2-7) — real provider unverified live
packages/...            scanners, audit, db, ui, i18n (not started)
policies/               Default Rego policies (Gate 1) (not started)
templates/              App Spec templates, ready to run — the on-ramp for non-code contributions
docs/adr/               Architecture Decision Records
```

See [`03_REPOSITORY_リポジトリ構成とOSS運営.md`](./docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md) for the
full target layout and OSS governance model.

## Try it today

Thirteen packages are real, tested code so far — enough to log in through an actual Keycloak login
page, register a record through an HTML form, see row-level access control hold for different
logged-in users, and — through an actual web UI — describe an app in plain language, generate and
score it, and publish it into a real, live, loggable-into app, all in one sitting:

- **`packages/app-spec`** validates App Specs and enforces referential-integrity and
  security-shaped rules (no internal-IP egress, `actor` fields must be system-injected, etc.).
- **`packages/expr`** parses and compiles the restricted `computed`/`rowLevel` expression
  grammar (ADR-010, ADR-011) to SQL.
- **`packages/spec-compiler`** compiles a validated Spec to the PostgreSQL DDL and RLS policies
  that provision an app's isolated schema (ADR-007).
- **`services/sdk-gateway`** is the only process that holds an app's DB role — it executes
  CRUD against the schema spec-compiler provisioned, propagating the caller's identity so RLS
  can enforce it.
- **`packages/company-sdk`** is the HTTP client to sdk-gateway; it's the only interface
  application code is meant to use to touch data (01_ARCHITECTURE §5.1).
- **`packages/keycloak-admin`** provisions a Keycloak realm/client/roles/users over the Admin
  REST API — just enough for ADR-006, not a general-purpose SDK.
- **`packages/auth-bff`** is the Authorization Code + PKCE logic itself (ADR-006, BFF pattern) —
  the browser only ever holds an httpOnly session cookie, never a token.
- **`apps/runtime`** is the browser-facing piece: a REST API plus a server-rendered HTML MVP of
  the Spec renderer (form/list pages), gated by a real Keycloak login via `auth-bff`. Multiple
  apps can be served by one Runtime process, each on its own hostname (ADR-012) and its own OIDC
  client (ADR-006) — resolved from the request's Host header, never a URL path segment — with
  per-response origin-isolation headers (COOP/CORP/X-Frame-Options/CSP).
- **`packages/setup-guard`** gates a `/setup` endpoint with a one-time, scrypt-hashed token —
  creates the real initial admin via `keycloak-admin`, then permanently disables itself, even for
  the original valid token.
- **`packages/risk-engine`** turns a `Finding[]` into a deterministic GREEN/YELLOW/RED verdict
  (severity-weighted scoring, ADR-008) and Ed25519-signs it — a tampered verdict fails
  verification.
- **`packages/security-gate`** runs a Spec through Gate 0 (structural validation — already
  `app-spec`'s own validator), Gate 2 (regex secret scanning), and a Gate 6 PII heuristic, then
  scores the result with `risk-engine`.
- **`packages/ai-core`** turns a plain-language description into a validated App Spec:
  `generateAppSpec()` calls an `LlmProvider`, validates the result through the exact same
  `validateAppSpec` a hand-written Spec goes through, and on failure feeds the validation issues
  back for up to 3 self-repair attempts. Tested against a deterministic `FakeProvider`; the real
  `AnthropicProvider` is implemented but not yet exercised against a live API call (no key in this
  dev environment) — see `apps/console` below for how it plugs in when a key *is* available.
- **`apps/console`** is the Builder UI (04_IMPLEMENTATION E2-8, lightweight slice): a small web
  page — describe an app, get a generated Spec + Security Gate verdict, and (if it isn't RED) a
  "Publish" button that compiles it via `spec-compiler`, provisions a Keycloak realm role + a
  dedicated OIDC client (ADR-006 — never reused across apps), and registers it live into the same
  in-memory registries `sdk-gateway`/`apps/runtime` already serve from — no restart. Uses
  `AnthropicProvider` automatically when `ANTHROPIC_API_KEY` is set; otherwise falls back to a
  `TemplatePickerProvider` (also in `ai-core`) that keyword-matches the description against the 5
  shipped templates — an honest, zero-config "demo mode" banner says so on the page. Not an
  authenticated multi-tenant Console (M4's much larger, unbuilt item) — a local, single-operator
  dev/demo front door. Verified end to end for real: described an app in Japanese, generated it,
  published it, logged in as `alice` through Keycloak's actual hosted login page, and submitted a
  record into the newly-published app — all against a real Postgres + Keycloak stack.

All five integration suites (spec-compiler, sdk-gateway, auth-bff, runtime, setup-guard) apply
real requests to a real Postgres server and/or a real, freshly-provisioned Keycloak and prove the
whole thing actually holds end to end — auth-bff's, runtime's, and setup-guard's drive the
*actual* Keycloak-hosted login form or a real admin creation, not a mock — not just that the
generated SQL or the OIDC plumbing looks right on paper.

```bash
pnpm install
pnpm build
pnpm test                                                  # unit tests across all packages
pnpm --filter @aiappfactory/spec-compiler test:integration # needs a local Postgres — see below
pnpm --filter @aiappfactory/sdk-gateway test:integration
pnpm --filter @aiappfactory/auth-bff test:integration      # needs Docker — spins up its own Keycloak
pnpm --filter @aiappfactory/runtime test:integration       # needs both
pnpm --filter @aiappfactory/setup-guard test:integration   # needs Docker — spins up its own Keycloak
```

The Postgres-backed suites expect a reachable Postgres superuser at `127.0.0.1:5432` (this
repo's dev setup uses `brew install postgresql@14`, trust-authenticated on localhost); each
creates its own throwaway database and role and drops both in `afterAll`. The Keycloak-backed
suites need Docker and manage their own throwaway `quay.io/keycloak/keycloak` container the same
way. All four are wired into CI (`.github/workflows/ci.yml`'s `integration` job).

To actually click around instead of just running tests:

```bash
pnpm dev:sample
# → http://sales-daily-report.apps.localhost:4200/pages/0
# → http://expense-request.apps.localhost:4200/pages/0
# → http://127.0.0.1:4300  (Builder UI — describe an app, generate, publish; see apps/console above)
# login: alice/alice-dev, bob/bob-dev, carol/carol-dev
```

This boots two different templates against a persistent local `aiaf_dev` Postgres database and a
persistent local `aiaf-dev-keycloak` Docker container, each app served from its own
`*.apps.localhost` origin (and its own OIDC client) by the same Runtime process —
`*.localhost` resolves to loopback automatically in Chrome and most resolvers (RFC 6761), no
`/etc/hosts` edit needed. Logging in redirects to Keycloak's own hosted login page — this is
real SSO, not a mock. Also boots the Builder UI (`apps/console`) on port 4300, sharing the same
live registries — publishing an app there takes effect immediately, no restart. A manual
convenience script (`scripts/dev-server.ts`), not part of the shipped product.

### Run via Docker Compose (M5 — no local Postgres/Keycloak install needed)

The fastest path — no local Postgres/Keycloak install, no files to hand-edit:

```bash
pnpm start
```

`scripts/quickstart.ts` checks Docker is running, generates `deploy/compose/.env` with random
passwords on first run (never overwrites an existing one), brings up Postgres/Valkey/Keycloak via
`docker compose up -d --wait`, waits for Keycloak specifically (it has no defined healthcheck —
the other two do), then launches `pnpm dev:sample` with the right `AIAF_*` env vars derived from
that `.env` automatically. Idempotent — safe to re-run; it reuses whatever's already there. See
[GETTING_STARTED.md](./GETTING_STARTED.md) for the fully narrated version.

**Want to see/control each step yourself** — set your own passwords, or point at a
Postgres/Keycloak you're already running elsewhere — do it by hand instead:

```bash
cp deploy/compose/.env.example deploy/compose/.env
# edit deploy/compose/.env — set POSTGRES_PASSWORD / VALKEY_PASSWORD / KEYCLOAK_ADMIN_PASSWORD
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d

AIAF_PG_USER=<POSTGRES_USER from .env, "factory" if you didn't change it> \
AIAF_PG_PASSWORD=<POSTGRES_PASSWORD from .env> \
AIAF_KEYCLOAK_URL=http://127.0.0.1:8180 \
AIAF_KEYCLOAK_ADMIN_PASSWORD=<KEYCLOAK_ADMIN_PASSWORD from .env> \
pnpm dev:sample
```

Both paths verified end to end in this repo: brought the compose stack up on isolated ports (for
`pnpm start`: including a from-scratch run that generates its own `.env`, and a second run proving
it reuses that `.env` and the already-provisioned realm/schema instead of redoing anything),
confirmed Postgres/Valkey report `healthy` and Keycloak's `/realms/master` responds, and confirmed
an actual HTTP request to the runtime (`/healthz` → 200, an unauthenticated page → 302 to
`/auth/login`) worked. What neither path does yet (the harder half of M5's own Definition of Done):
package `apps/runtime`/`sdk-gateway` themselves as a container image — those still run as host
Node processes via `pnpm dev:sample`, not inside Compose.

```ts
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { readFileSync } from "node:fs";

const result = parseAppSpecYaml(readFileSync("templates/sales-daily-report/app.yaml", "utf-8"));
if (!result.ok) {
  console.error(result.issues); // structured, machine-actionable — this is what an Auto Fix loop consumes
} else {
  console.log(result.spec.metadata.name, result.specHash);
}
```

Five worked example Specs live in [`templates/`](./templates/) (M7's early progress toward its
"10 templates" goal — see ROADMAP.md): a sales daily report, an expense request flow with an
approval role, a meeting-room booking system with a `reference` field, an IT equipment request
with an unscoped admin role, and a vacation request with department-scoped manager approval.

### Check your setup, and generate an SBOM

```bash
pnpm doctor   # M6: Node/pnpm/Docker presence, RAM/disk, and dev-flow port availability — with
              # a Japanese remediation hint for anything that isn't clean
pnpm sbom     # M10: a real CycloneDX 1.5 SBOM (sbom.cdx.json) covering all 12 workspace packages
              # and every resolved third-party dependency, with real license data — also runs in
              # CI on every push as a build artifact
```

## Architecture Decision Records

Key decisions (and the alternatives rejected) are in [`docs/adr/`](./docs/adr/), including why the
Spec model exists at all (ADR-001), why every app gets its own subdomain instead of a path
(ADR-012), and why `access.rowLevel` is a restricted DSL rather than a general expression language
(ADR-011).

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md). In short: M0 (this scaffold) → M1 Walking Skeleton (a Spec you
hand-write turns into a running app with no AI involved) → M2 AI Builder (generate that same kind
of Spec from a description) → M3 Security Gate (score it GREEN/YELLOW/RED) → M4 Identity & Store →
M5 v0.1 Public Alpha (run it via Compose) → M6 Operations → M7 Polish & i18n → M8 v0.5 Public Beta
(real-company pilots — deliberately not attempted) → M9 Hardening → M10 v1.0 GA (SBOM generated;
signing and an actual GA declaration still pending) → M11 Desktop (not attempted).
M0/M2/M3/M5/M6/M7/M9/M10 above are lightweight first slices, not their full scope; M8 and M11 are
untouched by design — see ROADMAP.md for why.

## Contributing

Not accepting external PRs yet — the Spec schema (`packages/app-spec`) needs to stabilize first,
since it's the contract everything else is built against. Once M1 lands, see
[`CONTRIBUTING.md`](./CONTRIBUTING.md); the lowest-friction way to contribute will be a new
**App Template** (a YAML file — no programming required).

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). The core is, and will remain,
Apache-2.0; any Enterprise add-ons ship from a separate repository under a separate license —
see [`docs/adr/003-license-apache-2.md`](./docs/adr/003-license-apache-2.md).
# ai-app-factory
