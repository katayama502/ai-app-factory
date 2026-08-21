# ADR-002: Language and stack — TypeScript end-to-end on Node 24 LTS

**Status:** Accepted
**Date:** 2026-08-21

## Context

Console, Factory API, App Runtime, Company SDK, and the App Spec schema all need to share types
and validation logic. Splitting languages across these layers would force the Spec schema to be
re-implemented (and drift) in multiple languages.

## Decision

TypeScript everywhere: Next.js 15 (App Router) / React 19 for the Console, Fastify 5 for the API
layer, Zod 4 for schema definition (source of truth, compiled to JSON Schema), Prisma 6 for
Control Plane migrations, PostgreSQL 17 + pgvector as the database. Runtime target is Node.js 24
LTS (Node 22 reaches EOL 2027-04, which does not clear v1.0 GA + 12 months of LTS support).

## Consequences

- One dependency graph, one type system, one test runner (Vitest) across the whole monorepo.
- Local dev machines only need Node + pnpm; no polyglot toolchain to install.
- Node 24 LTS is newer than what most contributors have installed by default (this repo's dev
  container / CI pins it explicitly); local development against Node 20+ is tolerated as long as
  CI runs on 24.
