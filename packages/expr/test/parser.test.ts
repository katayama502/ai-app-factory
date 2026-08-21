import { describe, expect, it } from "vitest";
import { parseExpr } from "../src/parser.js";
import { ExprSyntaxError } from "../src/lexer.js";

describe("parseExpr", () => {
  it("parses a simple comparison", () => {
    expect(parseExpr("amount > 1000000")).toEqual({
      kind: "binary",
      op: ">",
      left: { kind: "identifier", path: ["amount"] },
      right: { kind: "literal", value: 1000000 },
    });
  });

  it("respects operator precedence: && binds tighter than ||", () => {
    const ast = parseExpr("a || b && c");
    expect(ast).toEqual({
      kind: "binary",
      op: "||",
      left: { kind: "identifier", path: ["a"] },
      right: {
        kind: "binary",
        op: "&&",
        left: { kind: "identifier", path: ["b"] },
        right: { kind: "identifier", path: ["c"] },
      },
    });
  });

  it("respects parens overriding precedence", () => {
    const ast = parseExpr("(a || b) && c");
    expect(ast).toEqual({
      kind: "binary",
      op: "&&",
      left: {
        kind: "binary",
        op: "||",
        left: { kind: "identifier", path: ["a"] },
        right: { kind: "identifier", path: ["b"] },
      },
      right: { kind: "identifier", path: ["c"] },
    });
  });

  it("parses member access", () => {
    expect(parseExpr("record.author")).toEqual({ kind: "identifier", path: ["record", "author"] });
    expect(parseExpr("ctx.user.department")).toEqual({ kind: "identifier", path: ["ctx", "user", "department"] });
  });

  it("parses function calls", () => {
    expect(parseExpr("department_of(record.author)")).toEqual({
      kind: "call",
      name: "department_of",
      args: [{ kind: "identifier", path: ["record", "author"] }],
    });
  });

  it("parses array literals and `in`", () => {
    expect(parseExpr('status in ["draft", "submitted"]')).toEqual({
      kind: "binary",
      op: "in",
      left: { kind: "identifier", path: ["status"] },
      right: {
        kind: "array",
        items: [
          { kind: "literal", value: "draft" },
          { kind: "literal", value: "submitted" },
        ],
      },
    });
  });

  it("parses unary negation and not", () => {
    expect(parseExpr("!record.isLargeDeal")).toEqual({
      kind: "unary",
      op: "!",
      expr: { kind: "identifier", path: ["record", "isLargeDeal"] },
    });
    expect(parseExpr("-amount")).toEqual({ kind: "unary", op: "-", expr: { kind: "identifier", path: ["amount"] } });
  });

  it("parses booleans", () => {
    expect(parseExpr("true")).toEqual({ kind: "literal", value: true });
  });

  it("throws ExprSyntaxError on invalid input", () => {
    expect(() => parseExpr("amount >")).toThrow(ExprSyntaxError);
    expect(() => parseExpr("amount $ 5")).toThrow(ExprSyntaxError);
    expect(() => parseExpr("(amount")).toThrow(ExprSyntaxError);
    expect(() => parseExpr("amount 5")).toThrow(ExprSyntaxError);
  });
});
