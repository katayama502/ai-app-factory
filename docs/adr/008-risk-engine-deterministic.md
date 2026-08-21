# ADR-008: Risk judgment is deterministic; AI can only raise risk, never clear it

**Status:** Accepted
**Date:** 2026-08-21

## Context

There is no human code reviewer in this product's normal path — a non-engineer publishes an app
an AI helped build. If the AI (or a probabilistic scanner) can be the reason something is marked
safe, a false negative becomes a silent security failure with nobody positioned to catch it.

## Decision

The GREEN/YELLOW/RED publish decision is computed by `risk-engine` as a deterministic function of
structured `findings` (severity × confidence × gate-weight, plus hard-block and require-approval
rule lists evaluated in Rego — see `02_SECURITY §4.3`). Gate 7 (AI Review) may only ever *add*
findings, capped at severity MEDIUM; it can never downgrade a finding, clear a hard-block, or
independently produce a GREEN. A scanner crash or timeout is treated as RED (fail closed, P2), not
skipped. The final verdict is Ed25519-signed, and the Deploy Engine refuses to deploy without a
valid signature (T-05).

## Consequences

- "Security PASS" always traces to a reproducible, inspectable rule evaluation — never to a model
  output that can't be re-run identically.
- AI Review is still useful (catches things rules don't know to check for) without being a single
  point of failure for approval.
- This is the concrete mechanism behind Security Design Principle P3 (AI Never Approves).
