import type { Expr } from "./ast.js";
import { ExprValidationError } from "./errors.js";
import { parseExpr } from "./parser.js";
import { quoteIdent, quoteLiteral } from "./sql-util.js";

export interface ComputedContext {
  /** Names of this entity's *stored* fields — computed fields may only read stored data. */
  entityFields: ReadonlySet<string>;
}

/**
 * Validates a T2 `computed` field expression (ADR-010): arithmetic + comparison +
 * boolean logic over this row's own stored fields. No `ctx.user.*` (Postgres
 * `GENERATED ALWAYS AS` columns must be deterministic — session state isn't allowed
 * there, and this grammar restriction just makes that Postgres constraint explicit
 * up front instead of failing at DDL-apply time), and no function calls (the
 * resolver-function set is a rowLevel-only concept, see `rowlevel.ts`).
 */
export function validateComputedExpr(expr: Expr, ctx: ComputedContext): void {
  walk(expr);

  function walk(node: Expr): void {
    switch (node.kind) {
      case "literal":
        return;
      case "identifier": {
        // Bare field names only (01_ARCHITECTURE §1.4 example: `expr: "amount > 1000000"`)
        // — a computed field reads sibling fields on the same row, nothing else.
        if (node.path.length !== 1) {
          throw new ExprValidationError(
            `computed expressions may only reference a bare field name on the same entity, got "${node.path.join(".")}"`
          );
        }
        const field = node.path[0] as string;
        if (!ctx.entityFields.has(field)) {
          throw new ExprValidationError(`unknown field "${field}"`);
        }
        return;
      }
      case "call":
        throw new ExprValidationError(`function calls are not allowed in computed expressions ("${node.name}")`);
      case "unary":
        walk(node.expr);
        return;
      case "binary":
        if (node.op === "in") {
          throw new ExprValidationError('"in" is a rowLevel-only operator, not allowed in computed expressions');
        }
        walk(node.left);
        walk(node.right);
        return;
      case "array":
        throw new ExprValidationError("array literals are not allowed in computed expressions");
    }
  }
}

/** Compiles a validated computed-field expression to a SQL fragment for `GENERATED ALWAYS AS (<here>) STORED`. */
export function compileComputedToSql(expr: Expr): string {
  switch (expr.kind) {
    case "literal":
      return compileLiteral(expr.value);
    case "identifier":
      return quoteIdent(expr.path[0] as string);
    case "call":
      throw new ExprValidationError(`unreachable: call "${expr.name}"`);
    case "unary":
      return expr.op === "!" ? `(NOT ${compileComputedToSql(expr.expr)})` : `(-${compileComputedToSql(expr.expr)})`;
    case "binary":
      return compileBinary(expr.op, expr.left, expr.right);
    case "array":
      throw new ExprValidationError("unreachable: array literal");
  }
}

function compileLiteral(value: string | number | boolean): string {
  if (typeof value === "string") return quoteLiteral(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function compileBinary(op: string, left: Expr, right: Expr): string {
  const sqlOp =
    op === "==" ? "=" : op === "!=" ? "<>" : op === "&&" ? "AND" : op === "||" ? "OR" : op === "in" ? "IN" : op;
  return `(${compileComputedToSql(left)} ${sqlOp} ${compileComputedToSql(right)})`;
}

/** Convenience: parse + validate + compile in one call. */
export function compileComputedExpression(source: string, ctx: ComputedContext): string {
  const expr = parseExpr(source);
  validateComputedExpr(expr, ctx);
  return compileComputedToSql(expr);
}
