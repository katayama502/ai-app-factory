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
      SHA-256 hashing — 18 passing tests
- [x] 3 hand-written sample Specs validated against the schema (`templates/`)
- [x] CI: lint / typecheck / test / build wired through Turborepo
- [x] README (EN primary + JA), LICENSE (Apache-2.0), NOTICE, CONTRIBUTING, SECURITY,
      CODE_OF_CONDUCT
- [ ] `docker-compose.yml` (postgres + valkey only) — scaffolded, not yet run end-to-end
- [ ] Setup token protection + initial admin creation (T-08) — **not started**; this is the one
      M0 item that blocks a public Alpha and must not slip to M6

## M1 — Walking Skeleton (next)

Goal: a hand-written Spec, with no AI involved, becomes a running app reachable in a browser.

- [ ] `spec-compiler`: Spec → DDL, schema/role creation, RLS policy generation, `SET LOCAL`
      principal propagation (ADR-007)
- [ ] `runtime/data`: Spec → CRUD API (Fastify + Kysely)
- [ ] `runtime/renderer`: Spec → form / list / dashboard UI (React)
- [ ] `company-sdk` + `sdk-gateway` minimal (database + auth only)
- [ ] `deploy-engine`: register a Spec, per-app subdomain routing (ADR-012), health check
- [ ] Origin isolation (`__Host-` cookies, per-app CSP, COOP) + security test S-15

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
