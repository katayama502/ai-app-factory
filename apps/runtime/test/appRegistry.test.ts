import { describe, expect, it } from "vitest";
import { RuntimeAppRegistry } from "../src/appRegistry.js";

const spec = {} as unknown as import("@aiappfactory/app-spec").AppSpec;

describe("RuntimeAppRegistry", () => {
  it("resolves an app by the exact hostname it was registered under", () => {
    const registry = new RuntimeAppRegistry();
    const app = { appId: "x", spec, gatewayUrl: "http://gw" };
    registry.register("x.apps.localhost", app);
    expect(registry.resolve("x.apps.localhost")).toBe(app);
  });

  it("returns undefined for an unregistered hostname", () => {
    const registry = new RuntimeAppRegistry();
    expect(registry.resolve("ghost.apps.localhost")).toBeUndefined();
  });

  it("keeps two apps under two different hostnames independent", () => {
    const registry = new RuntimeAppRegistry();
    const a = { appId: "a", spec, gatewayUrl: "http://gw" };
    const b = { appId: "b", spec, gatewayUrl: "http://gw" };
    registry.register("a.apps.localhost", a);
    registry.register("b.apps.localhost", b);
    expect(registry.resolve("a.apps.localhost")).toBe(a);
    expect(registry.resolve("b.apps.localhost")).toBe(b);
  });
});
