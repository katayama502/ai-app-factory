import { describe, expect, it } from "vitest";
import { compileComputedExpression } from "../src/computed.js";
import { ExprValidationError } from "../src/errors.js";

const ctx = { entityFields: new Set(["amount", "reportDate"]) };

describe("compileComputedExpression", () => {
  it("compiles the isLargeDeal example from the sales-daily-report template", () => {
    expect(compileComputedExpression("amount > 1000000", ctx)).toBe(`("amount" > 1000000)`);
  });

  it("compiles arithmetic", () => {
    expect(compileComputedExpression("amount * 1.1", ctx)).toBe(`("amount" * 1.1)`);
  });

  it("rejects ctx.user.* — GENERATED columns cannot read session state", () => {
    expect(() => compileComputedExpression("amount > 0 && ctx.user.id == amount", ctx)).toThrow(ExprValidationError);
  });

  it("rejects function calls — resolver functions are a rowLevel-only concept", () => {
    expect(() => compileComputedExpression("department_of(amount) > 0", ctx)).toThrow(ExprValidationError);
  });

  it("rejects unknown fields", () => {
    expect(() => compileComputedExpression("ghost > 0", ctx)).toThrow(ExprValidationError);
  });

  it("rejects the `in` operator (rowLevel-only)", () => {
    expect(() => compileComputedExpression('reportDate in ["a", "b"]', ctx)).toThrow(ExprValidationError);
  });
});
