/** The identity a request is executed as — propagated to sdk-gateway on every call, which sets it as `SET LOCAL factory.*` for RLS to see (ADR-007). Application code never constructs this from user input; it comes from the authenticated session (Keycloak, once M4 lands — see ROADMAP.md). */
export interface ExecutionContext {
  userId: string;
  department: string;
  roles: string[];
}

export type EntityRow = Record<string, unknown>;

export interface EntityClient<T extends EntityRow = EntityRow> {
  list(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface CompanySdk {
  database: {
    entity<T extends EntityRow = EntityRow>(name: string): EntityClient<T>;
  };
}

export interface CompanySdkOptions {
  /** Base URL of sdk-gateway, e.g. "http://localhost:4100". */
  gatewayUrl: string;
  appId: string;
  ctx: ExecutionContext;
  /** Override for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}
