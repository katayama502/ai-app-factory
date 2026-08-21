# ADR-009: Spec version history — bare git repo for v0.1, Gitea deferred to M6

**Status:** Accepted
**Date:** 2026-08-21

## Context

Spec versions need history (`app_versions`, "restore this version" in the Beginner UI). The full
design calls for Gitea (MIT-licensed, bundlable) as the Git backend. Standing up and operating
Gitea from day one is disproportionate cost for what the Beginner UI actually exposes, which is
just "version 12" / "restore this state" — never raw git concepts.

## Decision

v0.1 stores Spec history in a local `git` bare repository per app, driven directly by the `git`
binary (or an embedded implementation) from `services/api`. Gitea is introduced at M6, when
Developer Mode's "open the repository" feature needs an actual UI/API surface. The two are
interchangeable behind the same internal interface from day one so the swap is additive, not a
migration.

## Consequences

- No extra service to run, back up, or secure for the v0.1 Alpha milestone.
- Beginner-facing behavior (version numbers, restore) never has to change when Gitea is
  introduced, because it never spoke git concepts to begin with.
- Developer Mode's "view repository" feature is intentionally unavailable before M6 — documented
  as a known limitation rather than partially faked.
