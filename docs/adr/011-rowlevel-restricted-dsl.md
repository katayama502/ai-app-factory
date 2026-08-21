# ADR-011: `access.rowLevel` is a restricted DSL that compiles to RLS, not general CEL

**Status:** Accepted
**Date:** 2026-08-21

## Context

Row-level access rules (`own`, `dept`, ...) must ultimately become PostgreSQL RLS predicates
(ADR-007) so the database is the final enforcement layer, not just the SDK. General CEL — or even
the T2 expression grammar from ADR-010 — cannot be mechanically translated to SQL in general:
arbitrary function calls, free joins across entities, and regex have no safe or total mapping to a
`USING` clause.

## Decision

`access.rowLevel` expressions are restricted, at the schema level, to: comparison operators
(`==`, `!=`, `<`, `>`, `in`), boolean combinators (`&&`, `||`, `!`), fields on the current entity,
`ctx.user.*` (id / department / roles), and a fixed set of pre-defined resolver functions
(`department_of()`, `descendants_of()`, ...). Arbitrary function calls, free joins, regex, and
arithmetic are not part of the grammar. `packages/app-spec` enforces a coarse character-set/length
bound at parse time (see `rowLevelExprSchema` in `src/schema.ts`); `packages/spec-compiler`
performs the real grammar validation and the compilation to a Postgres `USING`/`WITH CHECK` clause.

## Consequences

- Every `rowLevel` rule that validates is guaranteed compilable to RLS — there is no "valid Spec
  that we can't actually enforce at the DB layer" state.
- This is deliberately less expressive than T2's `computed` expressions; that gap is the point,
  not an oversight — an author who needs more than `own`/`dept`-style rules needs a different
  access model, not a smarter parser.
- Shares its evaluator core with ADR-010's `packages/expr` where possible, but the *grammar*
  accepted for `rowLevel` is a strict subset, enforced independently so a future relaxation of the
  T2 grammar cannot silently relax `rowLevel` too.
