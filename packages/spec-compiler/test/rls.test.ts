import { describe, expect, it } from "vitest";
import { entityRlsStatements } from "../src/rls.js";

const dailyReport = {
  name: "DailyReport",
  label: "DailyReport",
  classification: "INTERNAL" as const,
  fields: [{ name: "author", type: "actor" as const, label: "Author", system: true }],
};

const room = {
  name: "Room",
  label: "Room",
  classification: "INTERNAL" as const,
  fields: [{ name: "roomName", type: "string" as const, label: "Name" }],
};

describe("entityRlsStatements", () => {
  it("always enables and forces RLS", () => {
    const access = { roles: [{ role: "member", grants: ["read" as const] }] };
    const statements = entityRlsStatements("app_x", dailyReport, access);
    expect(statements).toContain(`ALTER TABLE "app_x"."DailyReport" ENABLE ROW LEVEL SECURITY`);
    expect(statements).toContain(`ALTER TABLE "app_x"."DailyReport" FORCE ROW LEVEL SECURITY`);
  });

  it("compiles a SELECT policy combining role membership and a rowLevel scope", () => {
    const access = {
      roles: [{ role: "sales_member", grants: ["read:own" as const] }],
      rowLevel: { own: "record.author == ctx.user.id" },
    };
    const statements = entityRlsStatements("app_x", dailyReport, access);
    const policy = statements.find((s) => s.includes("FOR SELECT"));
    expect(policy).toContain(
      `'sales_member' = ANY(string_to_array(NULLIF(current_setting('factory.roles', true), ''), ','))`
    );
    expect(policy).toContain(`"author" = NULLIF(current_setting('factory.user_id', true), '')::uuid`);
  });

  it("OR-combines branches from multiple roles for the same command", () => {
    const access = {
      roles: [
        { role: "sales_member", grants: ["read:own" as const] },
        { role: "exec", grants: ["read" as const] },
      ],
      rowLevel: { own: "record.author == ctx.user.id" },
    };
    const [, , policy] = entityRlsStatements("app_x", dailyReport, access);
    expect(policy).toContain("OR");
    expect(policy).toContain("'exec'");
    expect(policy).toContain("'sales_member'");
  });

  it("emits no policy for a command nobody is granted (default-deny)", () => {
    const access = { roles: [{ role: "member", grants: ["read" as const] }] };
    const statements = entityRlsStatements("app_x", dailyReport, access);
    expect(statements.some((s) => s.includes("FOR DELETE"))).toBe(false);
    expect(statements.some((s) => s.includes("FOR INSERT"))).toBe(false);
  });

  it("uses WITH CHECK for INSERT and USING for the rest", () => {
    const access = { roles: [{ role: "member", grants: ["create" as const, "read" as const] }] };
    const statements = entityRlsStatements("app_x", dailyReport, access);
    expect(statements.find((s) => s.includes("FOR INSERT"))).toContain("WITH CHECK");
    expect(statements.find((s) => s.includes("FOR SELECT"))).toContain("USING");
  });

  it("silently drops a scoped grant that doesn't apply to this entity's fields, instead of failing the whole app (multi-entity access sharing, ADR-007)", () => {
    // rowLevel.own references "reservedBy", which Room does not have.
    const access = {
      roles: [{ role: "employee", grants: ["update:own" as const] }],
      rowLevel: { own: "record.reservedBy == ctx.user.id" },
    };
    const statements = entityRlsStatements("app_x", room, access);
    // No UPDATE policy at all — nobody gets update:own access to Room via this rule.
    expect(statements.some((s) => s.includes("FOR UPDATE"))).toBe(false);
  });

  it("throws if a scoped grant is used but rowLevel never defines that scope anywhere", () => {
    const access = { roles: [{ role: "member", grants: ["read:own" as const] }] };
    expect(() => entityRlsStatements("app_x", dailyReport, access)).toThrow(/rowLevel.own is not defined/);
  });
});
