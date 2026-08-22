import { afterEach, describe, expect, it, vi } from "vitest";
import { KeycloakAdminClient } from "../src/client.js";
import { assignRealmRoleToUser, deleteClient, deleteRealmRole, ensureRealmRole, findUserIdByUsername } from "../src/provisioning.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function authenticatedAdmin(handler: (url: string, init?: RequestInit) => Promise<Response>): Promise<KeycloakAdminClient> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
      return handler(url, init);
    })
  );
  return KeycloakAdminClient.authenticate({ baseUrl: "http://kc", adminUsername: "admin", adminPassword: "admin" });
}

describe("deleteClient (E9-8: ARCHIVED resource cleanup)", () => {
  it("looks up the client by clientId, then deletes it by its internal UUID", async () => {
    const calls: string[] = [];
    const admin = await authenticatedAdmin(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/clients?clientId=")) {
        return new Response(JSON.stringify([{ id: "uuid-123", clientId: "sales-daily-report" }]), { status: 200 });
      }
      if (url.endsWith("/clients/uuid-123")) return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await deleteClient(admin, "factory-dev", "sales-daily-report");
    expect(result).toBe(true);
    expect(calls.some((c) => c.startsWith("DELETE") && c.endsWith("/clients/uuid-123"))).toBe(true);
  });

  it("is idempotent: returns false and issues no DELETE when the client is already gone", async () => {
    const calls: string[] = [];
    const admin = await authenticatedAdmin(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/clients?clientId=")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await deleteClient(admin, "factory-dev", "already-archived-app");
    expect(result).toBe(false);
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});

describe("deleteRealmRole (E9-8: ARCHIVED resource cleanup)", () => {
  it("deletes the role and returns true", async () => {
    const admin = await authenticatedAdmin(async (url) => {
      expect(url).toBe("http://kc/admin/realms/factory-dev/roles/sales_member");
      return new Response(null, { status: 204 });
    });
    expect(await deleteRealmRole(admin, "factory-dev", "sales_member")).toBe(true);
  });

  it("is idempotent: a 404 (already deleted, or never provisioned) returns false instead of throwing", async () => {
    const admin = await authenticatedAdmin(async () => new Response("role not found", { status: 404 }));
    expect(await deleteRealmRole(admin, "factory-dev", "ghost_role")).toBe(false);
  });

  it("still throws on a real server error — only 404 is treated as an acceptable end state", async () => {
    const admin = await authenticatedAdmin(async () => new Response("internal error", { status: 500 }));
    await expect(deleteRealmRole(admin, "factory-dev", "sales_member")).rejects.toThrow();
  });
});

describe("ensureRealmRole (idempotent role creation, for publishing at runtime)", () => {
  it("creates the role and succeeds", async () => {
    const admin = await authenticatedAdmin(async (url, init) => {
      expect(init?.method).toBe("POST");
      expect(url).toBe("http://kc/admin/realms/factory-dev/roles");
      return new Response(null, { status: 201 });
    });
    await expect(ensureRealmRole(admin, "factory-dev", "employee")).resolves.toBeUndefined();
  });

  it("treats a 409 (role already exists) as success, not an error — two published apps can share a role name", async () => {
    const admin = await authenticatedAdmin(async () => new Response("role already exists", { status: 409 }));
    await expect(ensureRealmRole(admin, "factory-dev", "employee")).resolves.toBeUndefined();
  });

  it("still throws on a real server error — only 409 is treated as an acceptable end state", async () => {
    const admin = await authenticatedAdmin(async () => new Response("internal error", { status: 500 }));
    await expect(ensureRealmRole(admin, "factory-dev", "employee")).rejects.toThrow();
  });
});

describe("findUserIdByUsername", () => {
  it("returns the matching user's id", async () => {
    const admin = await authenticatedAdmin(async (url) => {
      expect(url).toBe("http://kc/admin/realms/factory-dev/users?username=alice&exact=true");
      return new Response(JSON.stringify([{ id: "user-abc", username: "alice" }]), { status: 200 });
    });
    expect(await findUserIdByUsername(admin, "factory-dev", "alice")).toBe("user-abc");
  });

  it("returns undefined when no user matches", async () => {
    const admin = await authenticatedAdmin(async () => new Response(JSON.stringify([]), { status: 200 }));
    expect(await findUserIdByUsername(admin, "factory-dev", "ghost")).toBeUndefined();
  });
});

describe("assignRealmRoleToUser", () => {
  it("looks up the role by name, then POSTs it to the user's role-mappings", async () => {
    const calls: string[] = [];
    const admin = await authenticatedAdmin(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/roles/employee")) return new Response(JSON.stringify({ id: "role-id", name: "employee" }), { status: 200 });
      if (url.endsWith("/users/user-abc/role-mappings/realm")) {
        expect(JSON.parse(init?.body as string)).toEqual([{ id: "role-id", name: "employee" }]);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await assignRealmRoleToUser(admin, "factory-dev", "user-abc", "employee");
    expect(calls.some((c) => c.startsWith("POST") && c.endsWith("/users/user-abc/role-mappings/realm"))).toBe(true);
  });
});
