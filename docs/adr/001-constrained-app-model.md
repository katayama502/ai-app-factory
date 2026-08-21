# ADR-001: Constrained App Model — AI generates a Spec, never arbitrary code

**Status:** Accepted
**Date:** 2026-08-21

## Context

The naive implementation of "AI builds apps for non-engineers" is: natural language → LLM writes
arbitrary code → scan it → deploy if it passes. This fails on three axes simultaneously:

1. **Generation success rate.** A full-stack app (auth, DB, UI, API) generated correctly in one
   shot is unreliable, and gets worse with smaller/local models. A non-engineer cannot self-recover
   from a failed generation.
2. **Scan precision.** SAST over arbitrary code has real false-positive/false-negative rates. A
   "Security PASS" badge the team cannot actually stand behind is worse than no badge.
3. **Repair loop divergence.** An AI that patches scan findings in arbitrary code tends to break
   something else, and the fix-scan-fix cycle diverges rather than converges.

## Decision

The AI never emits executable code as its primary output. It emits an **App Spec** — a declarative,
schema-validated document (`packages/app-spec`) — which a generic, pre-built **App Runtime**
interprets. Three generation tiers exist (T1 Declarative, T2 Expression, T3 Code), and T1/T2 are
the default; T3 (arbitrary TypeScript handlers) ships v1.0 as experimental, off by default, and
requires explicit admin opt-in with audit trail.

## Consequences

- Security becomes structural, not detective: SQL injection, RCE, and eval simply have no
  representation in the Spec grammar for T1/T2. Validation becomes deterministic schema/policy
  conformance instead of heuristic scanning.
- Generation success rate rises sharply because the model is filling in a form, not writing a
  program — this is what makes 7B-class local models viable at all.
- Runtime upgrades (including security patches) benefit every app built on it automatically.
- Trade-off: expressive power is capped by what the Spec grammar covers. See ADR-010 (T2 expression
  language) and R-01 in the implementation plan for how that ceiling is being managed.
