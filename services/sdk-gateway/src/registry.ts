import type { AppSpec } from "@aiappfactory/app-spec";
import type { Pool } from "pg";
import { AppNotFoundError } from "./errors.js";

export interface RegisteredApp {
  spec: AppSpec;
  /** A pool connected AS the app's own low-privilege role (see spec-compiler's roleNameFor) — never a superuser pool. sdk-gateway is not responsible for creating this role or its password; that's spec-compiler + Deploy Engine's job (02_SECURITY §7 encrypted_secrets, not yet built — see ROADMAP.md). */
  pool: Pool;
  schemaName: string;
}

/**
 * In-memory app registry. A real deployment reloads this from the Control Plane's
 * `apps`/`app_versions` tables and `encrypted_secrets` (not yet built — packages/db is
 * still on the roadmap). For M1's walking skeleton, whatever process embeds
 * sdk-gateway registers apps directly after running spec-compiler.
 */
export class AppRegistry {
  private readonly apps = new Map<string, RegisteredApp>();

  register(appId: string, app: RegisteredApp): void {
    this.apps.set(appId, app);
  }

  unregister(appId: string): void {
    this.apps.delete(appId);
  }

  get(appId: string): RegisteredApp {
    const app = this.apps.get(appId);
    if (!app) throw new AppNotFoundError(`no app registered with id "${appId}"`);
    return app;
  }
}
