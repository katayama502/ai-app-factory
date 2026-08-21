# ADR-005: Spec serialization — YAML for humans, canonical JSON + SHA-256 internally

**Status:** Accepted
**Date:** 2026-08-21

## Context

Specs are authored and diffed by both humans (Developer Mode, Git history) and machines (AI
Orchestrator, Spec Compiler). We need one format that both handle well, plus a stable content
hash for `app_versions.spec_hash` and for detecting whether a redeploy is actually a no-op.

## Decision

YAML is the canonical *authoring* format (`templates/*/app.yaml`, Developer Mode's Monaco editor).
Internally, a Spec is parsed to a JS object, validated against the Zod schema
(`packages/app-spec`), then canonicalized (recursive key-sort) to JSON and hashed with SHA-256.
Key order and formatting in the source YAML never affect the hash.

## Consequences

- `hashAppSpec()` in `packages/app-spec` is the single implementation of canonicalization; nothing
  else is allowed to hash a Spec independently, or the hashes will silently diverge.
- Two Specs that are semantically identical but differently formatted (or produced by different
  tools) get the same hash — this is required for Gate 0's re-validation-after-repair loop to
  detect convergence (`02_SECURITY §5.1`).
- JSON Schema for the same shape is derived from the Zod schema for tooling (editor completion,
  external validators) that doesn't want a TypeScript dependency.
