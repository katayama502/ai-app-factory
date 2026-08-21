# Governance

## Model

The project currently follows a BDFL (Benevolent Dictator For Life) model under its original
author. Decisions are made transparently: significant design choices are recorded as
[Architecture Decision Records](./docs/adr/) rather than made silently.

## Maintainer promotion

Not yet applicable (single maintainer). The target bar, once the project has external
contributors, is: sustained high-quality contribution over roughly 3 months / 10 merged PRs.

## Breaking changes

Proposed as a GitHub Issue tagged `rfc`, open for comment for at least 2 weeks, then recorded as
an ADR once decided. This applies in particular to `packages/app-spec`'s public schema — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Code ownership

See [`.github/CODEOWNERS`](./.github/CODEOWNERS). Per-area ownership (security / spec / runtime /
ui / docs) is introduced once the contributor base justifies it.

## Long-term aspirations

CNCF Sandbox / OpenSSF participation is a goal once the project has enough independent adopters
and maintainers to make that meaningful — not a v0.1 concern.
