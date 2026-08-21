# Contributing

This project is in early scaffolding (pre-M1) and not yet accepting external PRs — the App Spec
schema (`packages/app-spec`) is the contract everything else will be built against, and it needs
to stabilize first. Watch [`ROADMAP.md`](./ROADMAP.md); once M1 lands, this document will be
expanded with the actual contribution levels (L1 templates → L7 core, see
[`docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md`](./docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md) §6.2).

## Development setup (for anyone working on this repo today)

```bash
pnpm install
pnpm build       # turbo run build across all packages
pnpm lint
pnpm typecheck
pnpm test
```

## Commit sign-off (DCO)

All commits must be signed off (`git commit -s`), certifying you have the right to submit the
work under this project's license (Apache-2.0). See [ADR-003](./docs/adr/003-license-apache-2.md)
for why DCO was chosen over a CLA.

## Conventions

- TypeScript, `strict: true`, no implicit `any`.
- New packages under `packages/*` must have `lint`, `typecheck`, `test`, and `build` scripts —
  Turborepo's pipeline (`turbo.json`) assumes every workspace package implements these.
- Anything touching `packages/app-spec/src/schema.ts` is a change to a public contract
  (`app-spec` — see `docs/design/03_REPOSITORY...md` §1.3): breaking changes require a major
  version bump and a migration note, not just updated tests.
