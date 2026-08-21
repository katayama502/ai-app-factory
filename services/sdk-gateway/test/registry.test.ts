import { describe, expect, it } from "vitest";
import { findEntity } from "../src/crud.js";
import { AppNotFoundError, EntityNotFoundError } from "../src/errors.js";
import { AppRegistry } from "../src/registry.js";

const spec = {
  apiVersion: "factory.dev/v1",
  kind: "App",
  metadata: { id: "x", name: "X", owner: "eng", tier: "T1" },
  data: { entities: [{ name: "Widget", label: "Widget", classification: "INTERNAL", fields: [] }] },
  ui: { pages: [] },
  access: { roles: [] },
  automations: [],
  ai: { features: [] },
  network: { egress: [] },
} as unknown as import("@aiappfactory/app-spec").AppSpec;

describe("AppRegistry", () => {
  it("throws AppNotFoundError for an unregistered app", () => {
    const registry = new AppRegistry();
    expect(() => registry.get("ghost")).toThrow(AppNotFoundError);
  });

  it("returns what was registered", () => {
    const registry = new AppRegistry();
    const app = { spec, pool: {} as never, schemaName: "app_x" };
    registry.register("x", app);
    expect(registry.get("x")).toBe(app);
  });
});

describe("findEntity", () => {
  it("finds a known entity", () => {
    expect(findEntity(spec, "Widget").name).toBe("Widget");
  });

  it("throws EntityNotFoundError for an unknown entity", () => {
    expect(() => findEntity(spec, "Ghost")).toThrow(EntityNotFoundError);
  });
});
