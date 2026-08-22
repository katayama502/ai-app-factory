import { describe, expect, it } from "vitest";
import { RiskEngineError, evaluate } from "../src/scoring.js";
import type { Finding } from "../src/types.js";

const f = (partial: Partial<Finding>): Finding => ({ gate: "test", severity: "LOW", message: "x", ...partial });

describe("evaluate — thresholds", () => {
  it("no findings → GREEN, score 0", () => {
    const result = evaluate([]);
    expect(result.verdict).toBe("GREEN");
    expect(result.score).toBe(0);
  });

  it("a single LOW finding stays GREEN", () => {
    expect(evaluate([f({ severity: "LOW" })]).verdict).toBe("GREEN");
  });

  it("enough MEDIUM findings to cross 10 points → YELLOW", () => {
    const result = evaluate([f({ severity: "MEDIUM" }), f({ severity: "MEDIUM" })]); // 5+5=10
    expect(result.verdict).toBe("YELLOW");
  });

  it("any single CRITICAL finding → RED, regardless of total score", () => {
    const result = evaluate([f({ severity: "CRITICAL" })]);
    expect(result.verdict).toBe("RED");
  });

  it("enough HIGH findings to cross 100 points → RED", () => {
    const findings = Array.from({ length: 7 }, () => f({ severity: "HIGH" })); // 7*15=105
    expect(evaluate(findings).verdict).toBe("RED");
  });

  it("requiresApproval forces at least YELLOW even with a trivial score", () => {
    const result = evaluate([f({ severity: "LOW", requiresApproval: true })]);
    expect(result.verdict).toBe("YELLOW");
  });
});

describe("evaluate — AI review cap (ADR-008)", () => {
  it("accepts an ai-review finding at MEDIUM or below", () => {
    expect(() => evaluate([f({ severity: "MEDIUM", source: "ai-review" })])).not.toThrow();
  });

  it("rejects an ai-review finding above MEDIUM outright — AI can never author a HIGH/CRITICAL finding", () => {
    expect(() => evaluate([f({ severity: "HIGH", source: "ai-review" })])).toThrow(RiskEngineError);
    expect(() => evaluate([f({ severity: "CRITICAL", source: "ai-review" })])).toThrow(RiskEngineError);
  });

  it("a deterministic finding is not subject to the cap", () => {
    expect(() => evaluate([f({ severity: "CRITICAL", source: "deterministic" })])).not.toThrow();
  });

  it("many ai-review MEDIUM findings can still accumulate to YELLOW/RED via score — the cap bounds severity, not total impact", () => {
    const findings = Array.from({ length: 25 }, () => f({ severity: "MEDIUM", source: "ai-review" })); // 25*5=125
    expect(evaluate(findings).verdict).toBe("RED");
  });
});

describe("evaluate — determinism", () => {
  it("the same findings always produce the same score and verdict", () => {
    const findings = [f({ severity: "HIGH" }), f({ severity: "LOW" })];
    const a = evaluate(findings);
    const b = evaluate(findings);
    expect(a.score).toBe(b.score);
    expect(a.verdict).toBe(b.verdict);
  });
});
