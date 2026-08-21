# ADR-004: Container runtime — Podman by default, Docker-compatible

**Status:** Accepted
**Date:** 2026-08-21

## Context

Reaching non-engineer users eventually means a double-clickable desktop installer (Windows/macOS),
which requires bundling a container runtime. Docker Desktop's license requires a paid subscription
for companies over 250 employees or $10M revenue — bundling it in an Apache-2.0 OSS project would
impose an unexpected obligation on adopters.

## Decision

Podman (Apache-2.0) is the default container runtime: rootless on Linux, `podman machine` (WSL2 /
Apple Virtualization.framework) on Windows/macOS. Docker Compose file format compatibility is kept
via `podman-compose` / the Docker-API-compatible socket, so users with an existing Docker setup
are not forced to migrate.

## Consequences

- No commercial licensing landmine for adopters of any size.
- The Deploy Engine and any code that talks to the container runtime is written against a thin
  adapter, not the Docker SDK directly, so the Docker-compatible path stays a first-class option.
- Desktop installer work (Windows .exe / macOS .dmg, `ai-app-factory-desktop`) is deferred to v1.1
  specifically because Podman-on-desktop needs its own validation; v0.1 ships Compose + a Linux
  installer only.
