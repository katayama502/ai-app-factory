import { SdkGatewayError } from "./errors.js";
import type { CompanySdk, CompanySdkOptions, EntityClient, EntityRow, ExecutionContext } from "./types.js";

interface GatewayResponse<T> {
  ok: boolean;
  rows?: T[];
  row?: T;
  error?: string;
}

async function call<T>(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  appId: string,
  entity: string,
  op: "list" | "create" | "update" | "delete",
  body: Record<string, unknown>
): Promise<GatewayResponse<T>> {
  const res = await fetchImpl(`${gatewayUrl}/internal/apps/${encodeURIComponent(appId)}/entities/${encodeURIComponent(entity)}/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as GatewayResponse<T>;
  if (!res.ok || !json.ok) {
    throw new SdkGatewayError(json.error ?? `sdk-gateway request failed (${res.status})`, res.status);
  }
  return json;
}

function makeEntityClient<T extends EntityRow>(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  appId: string,
  entity: string,
  ctx: ExecutionContext
): EntityClient<T> {
  return {
    async list() {
      const res = await call<T>(fetchImpl, gatewayUrl, appId, entity, "list", { ctx });
      return res.rows ?? [];
    },
    async create(data) {
      const res = await call<T>(fetchImpl, gatewayUrl, appId, entity, "create", { ctx, data });
      return res.row as T;
    },
    async update(id, data) {
      const res = await call<T>(fetchImpl, gatewayUrl, appId, entity, "update", { ctx, id, data });
      return res.row as T;
    },
    async delete(id) {
      await call<T>(fetchImpl, gatewayUrl, appId, entity, "delete", { ctx, id });
    },
  };
}

/** Constructs the one object generated-app code (and our own runtime/data layer) is allowed to use to touch data — see 01_ARCHITECTURE §5.1. */
export function createCompanySdk(opts: CompanySdkOptions): CompanySdk {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    database: {
      entity<T extends EntityRow = EntityRow>(name: string) {
        return makeEntityClient<T>(fetchImpl, opts.gatewayUrl, opts.appId, name, opts.ctx);
      },
    },
  };
}
