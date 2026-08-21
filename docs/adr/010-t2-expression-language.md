# ADR-010: T2 expression language — a custom restricted AST evaluator, not CEL

**Status:** Accepted
**Date:** 2026-08-21

## Context

T2 (`computed` fields, `automations[].when`) needs a sandboxed expression language: enough power
for conditions and simple derived values, with a hard bound on execution time/memory, and no path
to arbitrary code execution. The original concept assumed CEL. In practice there is no
production-quality JavaScript/TypeScript implementation of CEL — `cel-go` is Go, which would mean
either (a) shipping and operating a second-language sidecar process purely to evaluate small
expressions, or (b) a WASM build of `cel-go` with its own maintenance and debugging surface.

Two options were compared in M0:

- **(a) Custom restricted AST evaluator, in TypeScript, in-process.** Small, explicit grammar
  (arithmetic, comparisons, boolean logic, field access, an allowlisted function set — no loops,
  no arbitrary function calls, no reflection). Same language and process as everything else in the
  monorepo.
- **(b) `cel-go` as a sidecar**, called over a local RPC. Standards-compliant CEL, but adds a Go
  toolchain to the build, a second runtime to deploy/monitor/sandbox, and a network hop (however
  local) on every expression evaluation, including bulk `bulkUpsert` validation paths.

## Decision

Go with **(a)**: a purpose-built restricted AST evaluator implemented in TypeScript
(`packages/expr`, not yet built as of this ADR). It only needs to support what the Spec grammar
actually allows T2 to express — comparisons, `&&`/`||`/`!`, arithmetic, field access on the
current record, and a small allowlisted resolver-function set — which is a strict subset of full
CEL. The same evaluator (with an even narrower grammar) also backs `access.rowLevel` under
ADR-011, so there is exactly one expression parser in the codebase, not two.

## Consequences

- No second language/runtime to operate for a single-node, non-engineer-hosted product — directly
  serves the "don't make self-hosting harder than it has to be" goal.
- We are not CEL-compliant; expressions written elsewhere as CEL will not port in unmodified. This
  is acceptable because the Spec grammar was never meant to expose general CEL to end users in the
  first place (ADR-011 already forces `rowLevel` below full CEL).
- `packages/expr` becomes a second package, alongside `app-spec`, that must be held to a very high
  bar: it is a sandboxed interpreter, and any escape from its grammar is a T2 RCE. It needs its own
  fuzz-style test suite before T2 ships (tracked for M2 / E2-12).
- If a real requirement for CEL compatibility appears later (e.g. importing external CEL policies),
  this ADR can be revisited without changing the Spec schema — `expr` is just a string.
