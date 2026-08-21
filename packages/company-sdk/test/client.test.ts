import { describe, expect, it, vi } from "vitest";
import { createCompanySdk, SdkGatewayError } from "../src/index.js";

const ctx = { userId: "u1", department: "d1", roles: ["member"] };

function fakeFetch(response: { status: number; body: unknown }) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as unknown as typeof fetch;
}

describe("createCompanySdk", () => {
  it("list() calls the /list endpoint and returns rows", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ok: true, rows: [{ id: "1" }] } });
    const sdk = createCompanySdk({ gatewayUrl: "http://gw", appId: "myapp", ctx, fetchImpl });
    const rows = await sdk.database.entity("Widget").list();
    expect(rows).toEqual([{ id: "1" }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://gw/internal/apps/myapp/entities/Widget/list",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ctx });
  });

  it("create() posts data alongside ctx and returns the created row", async () => {
    const fetchImpl = fakeFetch({ status: 201, body: { ok: true, row: { id: "1", title: "x" } } });
    const sdk = createCompanySdk({ gatewayUrl: "http://gw", appId: "myapp", ctx, fetchImpl });
    const row = await sdk.database.entity("Widget").create({ title: "x" });
    expect(row).toEqual({ id: "1", title: "x" });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ctx, data: { title: "x" } });
  });

  it("update() and delete() hit their respective endpoints with id", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ok: true, row: { id: "1" } } });
    const sdk = createCompanySdk({ gatewayUrl: "http://gw", appId: "myapp", ctx, fetchImpl });
    await sdk.database.entity("Widget").update("1", { title: "y" });
    expect(fetchImpl).toHaveBeenCalledWith("http://gw/internal/apps/myapp/entities/Widget/update", expect.anything());

    await sdk.database.entity("Widget").delete("1");
    expect(fetchImpl).toHaveBeenCalledWith("http://gw/internal/apps/myapp/entities/Widget/delete", expect.anything());
  });

  it("throws SdkGatewayError with the HTTP status on a non-ok response", async () => {
    const fetchImpl = fakeFetch({ status: 403, body: { ok: false, error: "permission denied" } });
    const sdk = createCompanySdk({ gatewayUrl: "http://gw", appId: "myapp", ctx, fetchImpl });
    await expect(sdk.database.entity("Widget").list()).rejects.toMatchObject({
      status: 403,
      message: "permission denied",
    });
    await expect(sdk.database.entity("Widget").list()).rejects.toBeInstanceOf(SdkGatewayError);
  });
});
