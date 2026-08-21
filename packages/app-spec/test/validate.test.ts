import { describe, expect, it } from "vitest";
import { hashAppSpec, validateAppSpec } from "../src/index.js";

const baseSpec = {
  apiVersion: "factory.dev/v1",
  kind: "App",
  metadata: { id: "test-app", name: "Test App", owner: "eng", tier: "T1" },
  data: {
    entities: [
      {
        name: "Widget",
        label: "Widget",
        classification: "INTERNAL",
        fields: [
          { name: "title", type: "string", label: "Title", required: true, maxLength: 100 },
          { name: "owner", type: "actor", label: "Owner", system: true },
        ],
      },
    ],
  },
  ui: {
    pages: [
      { type: "form", entity: "Widget", title: "New Widget" },
      { type: "list", entity: "Widget", columns: ["title"], search: ["title"] },
    ],
  },
  access: {
    roles: [{ role: "member", grants: ["create", "read:own"] }],
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("validateAppSpec — happy path", () => {
  it("accepts a well-formed minimal spec", () => {
    const result = validateAppSpec(baseSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.metadata.id).toBe("test-app");
      expect(result.specHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("hashes identically regardless of key order (ADR-005 canonicalization)", () => {
    const a = validateAppSpec(baseSpec);
    const reordered = {
      kind: baseSpec.kind,
      apiVersion: baseSpec.apiVersion,
      access: baseSpec.access,
      ui: baseSpec.ui,
      data: baseSpec.data,
      metadata: baseSpec.metadata,
    };
    const b = validateAppSpec(reordered);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.specHash).toBe(b.specHash);
    }
  });

  it("hashAppSpec matches validateAppSpec's specHash", () => {
    const result = validateAppSpec(baseSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(hashAppSpec(result.spec)).toBe(result.specHash);
    }
  });
});

describe("validateAppSpec — schema violations (Gate 0)", () => {
  it("rejects a reserved field name", () => {
    const spec = clone(baseSpec);
    spec.data.entities[0].fields.push({ name: "id", type: "string", label: "id" });
    const result = validateAppSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects an actor field without system: true", () => {
    const spec = clone(baseSpec);
    spec.data.entities[0].fields[1].system = false;
    const result = validateAppSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects a select field with no options", () => {
    const spec = clone(baseSpec);
    spec.data.entities[0].fields.push({ name: "status", type: "select", label: "Status" });
    const result = validateAppSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects internal-range egress hosts (SSRF, T-04)", () => {
    const spec = clone(baseSpec);
    spec.network = { egress: ["169.254.169.254"] };
    const result = validateAppSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("SSRF"))).toBe(true);
    }
  });

  it("rejects .internal / .local egress hosts", () => {
    const spec = clone(baseSpec);
    spec.network = { egress: ["db.internal"] };
    expect(validateAppSpec(spec).ok).toBe(false);
  });

  it("accepts a legitimate external egress host", () => {
    const spec = clone(baseSpec);
    spec.network = { egress: ["api.example.com"] };
    expect(validateAppSpec(spec).ok).toBe(true);
  });
});

describe("validateAppSpec — referential integrity", () => {
  it("rejects a list page column that does not exist on the entity", () => {
    const spec = clone(baseSpec);
    spec.ui.pages[1].columns = ["doesNotExist"];
    const result = validateAppSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("doesNotExist"))).toBe(true);
    }
  });

  it("rejects a page referencing an unknown entity", () => {
    const spec = clone(baseSpec);
    spec.ui.pages[0].entity = "Ghost";
    expect(validateAppSpec(spec).ok).toBe(false);
  });

  it("rejects a reference field pointing at an unknown entity", () => {
    const spec = clone(baseSpec);
    spec.data.entities[0].fields.push({ name: "linked", type: "reference", label: "Linked", references: "Ghost" });
    expect(validateAppSpec(spec).ok).toBe(false);
  });

  it("rejects an automation notify action targeting an unknown role", () => {
    const spec = clone(baseSpec);
    spec.automations = [
      {
        id: "notifyGhost",
        trigger: { on: "create", entity: "Widget" },
        actions: [{ type: "notify", channel: "email", to: "role:ghost", template: "x" }],
      },
    ];
    expect(validateAppSpec(spec).ok).toBe(false);
  });

  it("rejects a duplicate entity name", () => {
    const spec = clone(baseSpec);
    spec.data.entities.push(clone(baseSpec.data.entities[0]));
    expect(validateAppSpec(spec).ok).toBe(false);
  });
});
