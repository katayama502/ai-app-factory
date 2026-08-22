# Contributing

Thanks for your interest! First, read [`GETTING_STARTED.md`](./GETTING_STARTED.md) to get the
project running locally — that's the fastest way to see what's actually built versus what's still
on [`ROADMAP.md`](./ROADMAP.md).

**Current status**: still pre-v0.1, no tagged release, and the core App Spec schema
(`packages/app-spec`) — the contract every other package is built against — can still change in
breaking ways between commits. Small, well-scoped PRs are welcome (bug fixes, a new
`templates/*` App Spec, doc corrections, test coverage for something already built); please open
an issue before starting anything larger, since a big PR against a schema that's still moving is
the easiest way to end up with wasted work. See
[`docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md`](./docs/design/03_REPOSITORY_リポジトリ構成とOSS運営.md)
§6.2 for the intended long-term contribution levels (L1 templates → L7 core) — most of that
structure isn't built yet either, so treat it as direction, not a process you need to follow today.

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
