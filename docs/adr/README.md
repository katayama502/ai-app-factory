# Architecture Decision Records

| ADR | Title |
|---|---|
| [001](./001-constrained-app-model.md) | Constrained App Model — AI generates a Spec, never arbitrary code |
| [002](./002-language-and-stack.md) | Language and stack — TypeScript end-to-end on Node 24 LTS |
| [003](./003-license-apache-2.md) | License — Apache-2.0 with DCO |
| [004](./004-container-runtime-podman.md) | Container runtime — Podman by default, Docker-compatible |
| [005](./005-spec-serialization.md) | Spec serialization — YAML for humans, canonical JSON + SHA-256 internally |
| [006](./006-auth-keycloak-bff.md) | Authentication — Keycloak + BFF pattern, no tokens in the browser |
| [007](./007-data-isolation-schema-rls.md) | App data isolation — per-app schema + role + enforced RLS |
| [008](./008-risk-engine-deterministic.md) | Risk judgment is deterministic; AI can only raise risk, never clear it |
| [009](./009-git-backend-deferred-gitea.md) | Spec version history — bare git repo for v0.1, Gitea deferred to M6 |
| [010](./010-t2-expression-language.md) | T2 expression language — a custom restricted AST evaluator, not CEL |
| [011](./011-rowlevel-restricted-dsl.md) | `access.rowLevel` is a restricted DSL that compiles to RLS, not general CEL |
| [012](./012-per-app-origin.md) | Every app gets its own origin — subdomain, not a path |

New ADRs should follow [`template.md`](./template.md).
