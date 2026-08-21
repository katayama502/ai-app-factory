import { describe, expect, it } from "vitest";
import { ExprValidationError } from "../src/errors.js";
import { compileRowLevelExpression } from "../src/rowlevel.js";

const ctx = { entityFields: new Set(["author", "amount"]) };

describe("compileRowLevelExpression", () => {
  it("compiles record.<field> == ctx.user.id (the 'own' pattern)", () => {
    expect(compileRowLevelExpression("record.author == ctx.user.id", ctx)).toBe(
      `("author" = NULLIF(current_setting('factory.user_id', true), '')::uuid)`
    );
  });

  it("compiles a resolver-function call (the 'dept' pattern)", () => {
    expect(compileRowLevelExpression("department_of(record.author) == ctx.user.department", ctx)).toBe(
      `(department_of("author") = NULLIF(current_setting('factory.department', true), '')::uuid)`
    );
  });

  it("compiles ctx.user.roles membership via ANY()", () => {
    expect(compileRowLevelExpression('"admin" in ctx.user.roles', ctx)).toBe(
      `('admin' = ANY(string_to_array(NULLIF(current_setting('factory.roles', true), ''), ',')))`
    );
  });

  it("compiles boolean combinators", () => {
    const sql = compileRowLevelExpression("record.author == ctx.user.id || record.amount > 100", ctx);
    expect(sql).toBe(
      `(("author" = NULLIF(current_setting('factory.user_id', true), '')::uuid) OR ("amount" > 100))`
    );
  });

  it("rejects record.<field>.<deeper> dereferencing (the whole point of ADR-011)", () => {
    expect(() => compileRowLevelExpression("record.author.department == ctx.user.department", ctx)).toThrow(
      ExprValidationError
    );
  });

  it("rejects unknown fields", () => {
    expect(() => compileRowLevelExpression("record.ghost == ctx.user.id", ctx)).toThrow(ExprValidationError);
  });

  it("rejects non-allowlisted function calls", () => {
    expect(() => compileRowLevelExpression("evil(record.author) == ctx.user.id", ctx)).toThrow(ExprValidationError);
  });

  it("rejects arithmetic", () => {
    expect(() => compileRowLevelExpression("record.amount + 1 > 0", ctx)).toThrow(ExprValidationError);
  });

  it("rejects identifiers that aren't record.* or ctx.user.*", () => {
    expect(() => compileRowLevelExpression("something.else == 1", ctx)).toThrow(ExprValidationError);
  });

  it("string literals are safely escaped", () => {
    const sql = compileRowLevelExpression("record.author == \"o'brien\"", { entityFields: new Set(["author"]) });
    expect(sql).toBe(`("author" = 'o''brien')`);
  });
});
