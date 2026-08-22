import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAppSpecYaml } from "@aiappfactory/app-spec";
import { RiskEngineError } from "@aiappfactory/risk-engine";
import { describe, expect, it } from "vitest";
import { runSecurityGate } from "../src/evaluateSpec.js";

const templatesDir = join(import.meta.dirname, "..", "..", "..", "templates");

const baseSpec = {
  apiVersion: "factory.dev/v1",
  kind: "App",
  metadata: { id: "test-app", name: "Test", owner: "eng", tier: "T1" },
  data: {
    entities: [
      {
        name: "Widget",
        label: "Widget",
        classification: "INTERNAL",
        fields: [{ name: "title", type: "string", label: "Title", maxLength: 100 }],
      },
    ],
  },
  ui: { pages: [{ type: "form", entity: "Widget", title: "New" }] },
  access: { roles: [{ role: "member", grants: ["read"] }] },
};

describe("runSecurityGate — Gate 0 hard block", () => {
  it("an invalid Spec is RED, with a CRITICAL finding per validation issue, and skips the other gates", () => {
    const result = runSecurityGate({ not: "a valid spec" });
    expect(result.verdict).toBe("RED");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.severity === "CRITICAL" && f.gate === "gate0-spec-validation")).toBe(true);
  });

  it("a structurally valid Spec with nothing else wrong is GREEN", () => {
    const result = runSecurityGate(baseSpec);
    expect(result.verdict).toBe("GREEN");
    expect(result.specHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runSecurityGate — a genuinely dangerous Spec is RED (04_IMPLEMENTATION §5's 危険なSpec fixture spirit)", () => {
  it("an SSRF-shaped internal-IP egress declaration is caught by Gate 0 and comes back RED", () => {
    const dangerous = { ...baseSpec, network: { egress: ["169.254.169.254"] } }; // cloud metadata endpoint
    const result = runSecurityGate(dangerous);
    expect(result.verdict).toBe("RED");
    expect(result.findings.some((f) => f.message.includes("SSRF"))).toBe(true);
  });
});

describe("runSecurityGate — Gate 2 (secrets)", () => {
  it("catches a pasted private key in the Spec source text", () => {
    const sourceText = JSON.stringify(baseSpec) + "\n-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...";
    const result = runSecurityGate(baseSpec, { sourceText });
    expect(result.verdict).toBe("RED"); // CRITICAL
    expect(result.findings.some((f) => f.gate === "gate2-secrets")).toBe(true);
  });

  it("catches an AWS access key", () => {
    const sourceText = JSON.stringify(baseSpec) + " AKIAABCDEFGHIJKLMNOP";
    const result = runSecurityGate(baseSpec, { sourceText });
    expect(result.findings.some((f) => f.gate === "gate2-secrets" && f.severity === "HIGH")).toBe(true);
  });

  it("does not false-positive on ordinary Spec text", () => {
    const result = runSecurityGate(baseSpec, { sourceText: JSON.stringify(baseSpec) });
    expect(result.findings.some((f) => f.gate === "gate2-secrets")).toBe(false);
  });
});

describe("runSecurityGate — Gate 6 (PII under-classification heuristic)", () => {
  it("flags an email-looking field on an INTERNAL (not PERSONAL+) entity", () => {
    const spec = {
      ...baseSpec,
      data: {
        entities: [
          {
            name: "Contact",
            label: "Contact",
            classification: "INTERNAL",
            fields: [{ name: "email", type: "string", label: "Email", maxLength: 200 }],
          },
        ],
      },
      ui: { pages: [{ type: "form", entity: "Contact", title: "New" }] },
    };
    const result = runSecurityGate(spec);
    const finding = result.findings.find((f) => f.gate === "gate6-data-classification");
    expect(finding).toBeDefined();
    expect(finding?.requiresApproval).toBe(true);
    expect(result.verdict).not.toBe("GREEN"); // requiresApproval forces at least YELLOW
  });

  it("does not flag the same field once the entity is classified PERSONAL", () => {
    const spec = {
      ...baseSpec,
      data: {
        entities: [
          {
            name: "Contact",
            label: "Contact",
            classification: "PERSONAL",
            fields: [{ name: "email", type: "string", label: "Email", maxLength: 200 }],
          },
        ],
      },
      ui: { pages: [{ type: "form", entity: "Contact", title: "New" }] },
    };
    const result = runSecurityGate(spec);
    expect(result.findings.some((f) => f.gate === "gate6-data-classification")).toBe(false);
    expect(result.verdict).toBe("GREEN");
  });
});

describe("runSecurityGate — AI review integration point (ADR-008 cap)", () => {
  it("propagates risk-engine's rejection of an ai-review finding above MEDIUM", () => {
    expect(() =>
      runSecurityGate(baseSpec, {
        aiReviewFindings: [{ gate: "gate7-ai-review", severity: "CRITICAL", message: "AI thinks this is bad", source: "ai-review" }],
      })
    ).toThrow(RiskEngineError);
  });

  it("accepts and folds in an ai-review finding at MEDIUM", () => {
    const result = runSecurityGate(baseSpec, {
      aiReviewFindings: [{ gate: "gate7-ai-review", severity: "MEDIUM", message: "worth a look", source: "ai-review" }],
    });
    expect(result.findings.some((f) => f.gate === "gate7-ai-review")).toBe(true);
  });
});

describe("runSecurityGate — the three shipped templates all come back GREEN (04_IMPLEMENTATION §5's fixture-testing spirit, in miniature)", () => {
  const templateNames = readdirSync(templatesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("found the expected templates", () => {
    expect(templateNames.length).toBeGreaterThan(0);
  });

  for (const name of templateNames) {
    it(`templates/${name} is GREEN with zero findings — no false positives on a normal Spec`, () => {
      const sourceText = readFileSync(join(templatesDir, name, "app.yaml"), "utf-8");
      const parsed = parseAppSpecYaml(sourceText);
      if (!parsed.ok) throw new Error(`template failed app-spec validation: ${JSON.stringify(parsed.issues)}`);
      const result = runSecurityGate(parsed.spec, { sourceText });
      if (result.verdict !== "GREEN") {
        throw new Error(`expected GREEN, got ${result.verdict}: ${JSON.stringify(result.findings, null, 2)}`);
      }
    });
  }
});
