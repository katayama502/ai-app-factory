import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppSpecYaml } from "../src/index.js";

// packages/app-spec/test -> ../../../templates
const templatesDir = join(import.meta.dirname, "..", "..", "..", "templates");

describe("core templates validate against App Spec v0 (04_IMPLEMENTATION §14 step 6)", () => {
  const templateNames = readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("found at least one template", () => {
    expect(templateNames.length).toBeGreaterThan(0);
  });

  for (const name of templateNames) {
    it(`templates/${name}/app.yaml is a valid, self-consistent Spec`, () => {
      const source = readFileSync(join(templatesDir, name, "app.yaml"), "utf-8");
      const result = parseAppSpecYaml(source);
      if (!result.ok) {
        throw new Error(`${name}: ${JSON.stringify(result.issues, null, 2)}`);
      }
      expect(result.ok).toBe(true);
    });
  }
});
