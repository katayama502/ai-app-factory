import type { AppSpec } from "@aiappfactory/app-spec";

export interface RuntimeApp {
  appId: string;
  spec: AppSpec;
  gatewayUrl: string;
}

/**
 * Which app a request means is decided by the ORIGIN it arrived on, not a path
 * segment (ADR-012 — every app gets its own subdomain, not `/apps/<slug>`, because
 * path-based hosting can't give the browser a real same-origin-policy boundary
 * between apps). This registry maps hostname → app; `apps/runtime` resolves it from
 * `request.hostname` on every request.
 *
 * Real DNS/TLS provisioning per app is `deploy-engine`'s job, not built yet
 * (ROADMAP.md) — this registry is the routing table deploy-engine will eventually
 * populate. For now, whatever process wires up this Runtime registers hostnames
 * directly (see scripts/dev-server.ts), typically `<slug>.apps.localhost`, which
 * Chrome and most resolvers already route to 127.0.0.1 with no `/etc/hosts` edit
 * (RFC 6761).
 */
export class RuntimeAppRegistry {
  private readonly byHost = new Map<string, RuntimeApp>();

  register(hostname: string, app: RuntimeApp): void {
    this.byHost.set(hostname, app);
  }

  resolve(hostname: string): RuntimeApp | undefined {
    return this.byHost.get(hostname);
  }
}
