import { describe, expect, it } from "vitest";
import { getAppSpecJsonSchema } from "../src/jsonSchema.js";

describe("getAppSpecJsonSchema", () => {
  it("produces a JSON Schema object describing the App Spec shape", () => {
    const schema = getAppSpecJsonSchema() as { type: string; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["apiVersion", "kind", "metadata", "data", "ui", "access"])
    );
  });

  it("returns the same (cached) object on repeated calls", () => {
    expect(getAppSpecJsonSchema()).toBe(getAppSpecJsonSchema());
  });

  it("is JSON-serializable (no functions/symbols/circular refs left over from Zod)", () => {
    expect(() => JSON.stringify(getAppSpecJsonSchema())).not.toThrow();
  });
});
