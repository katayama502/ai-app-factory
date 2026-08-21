import { afterEach, describe, expect, it, vi } from "vitest";
import { KeycloakAdminClient, KeycloakAdminError } from "../src/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KeycloakAdminClient.authenticate", () => {
  it("posts a password grant to the master realm's admin-cli client and stores the token", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://kc/realms/master/protocol/openid-connect/token");
      expect(init.method).toBe("POST");
      expect((init.body as URLSearchParams).get("client_id")).toBe("admin-cli");
      return new Response(JSON.stringify({ access_token: "the-token" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const admin = await KeycloakAdminClient.authenticate({ baseUrl: "http://kc", adminUsername: "admin", adminPassword: "admin" });
    expect(admin).toBeInstanceOf(KeycloakAdminClient);
  });

  it("throws KeycloakAdminError on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad credentials", { status: 401 }))
    );
    await expect(KeycloakAdminClient.authenticate({ baseUrl: "http://kc", adminUsername: "x", adminPassword: "y" })).rejects.toBeInstanceOf(
      KeycloakAdminError
    );
  });
});

describe("KeycloakAdminClient#requestCreated", () => {
  it("extracts the id from the Location header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
        return new Response(null, { status: 201, headers: { location: "http://kc/admin/realms/x/users/abc-123" } });
      })
    );
    const admin = await KeycloakAdminClient.authenticate({ baseUrl: "http://kc", adminUsername: "a", adminPassword: "b" });
    const id = await admin.requestCreated("/admin/realms/x/users", { username: "alice" });
    expect(id).toBe("abc-123");
  });

  it("throws if the server reports success but no Location header is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
        return new Response(null, { status: 201 });
      })
    );
    const admin = await KeycloakAdminClient.authenticate({ baseUrl: "http://kc", adminUsername: "a", adminPassword: "b" });
    await expect(admin.requestCreated("/admin/realms/x/users", {})).rejects.toBeInstanceOf(KeycloakAdminError);
  });
});
