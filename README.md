# AI App Factory — Community Edition

**Let non-engineers build internal business apps with AI — without letting AI write code that
runs in your production environment.**

[日本語 README](./README.ja.md) · [Architecture](./docs/) · [Roadmap](./ROADMAP.md) · [Security Model](./SECURITY.md)

> **Status: early design/scaffolding stage (pre-M1).** The core Spec schema and validator exist
> and are tested. The App Runtime, AI Builder, and Security Gate described below are the plan,
> not yet running code. See [ROADMAP.md](./ROADMAP.md) for what's real today.

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
apps/console/          Next.js — Builder UI / App Store / Admin / Setup Wizard (not started)
apps/runtime/          Generic App Runtime that interprets a Spec (T1/T2) (not started)
services/              Factory API, AI Gateway, AI Orchestrator, Security Gate, Deploy Engine, SDK Gateway (not started)
packages/app-spec/     ★ The Spec schema, validator, and canonical hashing — the foundation everything else builds on
packages/expr/         Restricted expression parser + compiler (ADR-010 computed fields, ADR-011 rowLevel → RLS)
packages/spec-compiler/  Spec → PostgreSQL DDL/RLS (ADR-007) — includes a real-Postgres integration test suite
packages/...           Company SDK, risk-engine, scanners, audit, db, ui, i18n (not started)
policies/              Default Rego policies (Gate 1) (not started)
templates/             App Spec templates, ready to run — the on-ramp for non-code contributions
docs/adr/              Architecture Decision Records
```

See [`03_REPOSITORY_リポジトリ構成とOSS運営.md`](./docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md) for the
full target layout and OSS governance model.

## Try it today

Three packages are real, tested code so far:

- **`packages/app-spec`** validates App Specs and enforces referential-integrity and
  security-shaped rules (no internal-IP egress, `actor` fields must be system-injected, etc.).
- **`packages/expr`** parses and compiles the restricted `computed`/`rowLevel` expression
  grammar (ADR-010, ADR-011) to SQL.
- **`packages/spec-compiler`** compiles a validated Spec to the PostgreSQL DDL and RLS policies
  that provision an app's isolated schema (ADR-007). Its integration suite applies that SQL to
  a real Postgres server and proves the row-level isolation actually holds — not just that the
  generated SQL parses.

```bash
pnpm install
pnpm build
pnpm test                                                   # unit tests across all packages
pnpm --filter @aiappfactory/spec-compiler test:integration  # needs a local Postgres — see below
```

The integration suite expects a reachable Postgres superuser at `127.0.0.1:5432` (this repo's
dev setup uses `brew install postgresql@14`, trust-authenticated on localhost). It creates one
throwaway database and one throwaway role and drops both in `afterAll`, regardless of pass/fail.
Not yet wired into CI — see `ROADMAP.md`.

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

Three worked example Specs live in [`templates/`](./templates/): a sales daily report, an expense
request flow with an approval role, and a meeting-room booking system with a `reference` field.

## Architecture Decision Records

Key decisions (and the alternatives rejected) are in [`docs/adr/`](./docs/adr/), including why the
Spec model exists at all (ADR-001), why every app gets its own subdomain instead of a path
(ADR-012), and why `access.rowLevel` is a restricted DSL rather than a general expression language
(ADR-011).

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md). In short: M0 (this scaffold) → M1 Walking Skeleton (a Spec you
hand-write turns into a running app with no AI involved) → M2 AI Builder → M3 Security Gate → ...
→ v0.1 Public Alpha.

## Contributing

Not accepting external PRs yet — the Spec schema (`packages/app-spec`) needs to stabilize first,
since it's the contract everything else is built against. Once M1 lands, see
[`CONTRIBUTING.md`](./CONTRIBUTING.md); the lowest-friction way to contribute will be a new
**App Template** (a YAML file — no programming required).

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). The core is, and will remain,
Apache-2.0; any Enterprise add-ons ship from a separate repository under a separate license —
see [`docs/adr/003-license-apache-2.md`](./docs/adr/003-license-apache-2.md).
