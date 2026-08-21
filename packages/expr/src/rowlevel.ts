import type { Expr } from "./ast.js";
import { ExprValidationError, UnknownFieldError } from "./errors.js";
import { parseExpr } from "./parser.js";
import { quoteIdent, quoteLiteral } from "./sql-util.js";

/**
 * Resolver functions a rowLevel expression may call (ADR-011). Each must exist as a
 * SQL function in the Control Plane schema, SECURITY DEFINER, callable by app roles —
 * this is how `department_of(record.author)` can safely read the Control Plane's
 * `users`/`departments` tables without granting the app role direct access to them.
 * `packages/spec-compiler` is responsible for actually creating these functions once
 * (they are platform-wide, not per-app).
 */
export const ROWLEVEL_RESOLVER_FUNCTIONS = new Set(["department_of", "descendants_of"]);

const CTX_USER_FIELDS = new Set(["id", "department", "roles"]);

export interface RowLevelContext {
  /** Field names that exist on the entity this rule is attached to (`record.<name>` targets). */
  entityFields: ReadonlySet<string>;
}

/**
 * Validates that `expr` only uses the grammar ADR-011 allows: comparisons, boolean
 * logic, `record.<field>` / `ctx.user.*`, and the fixed resolver-function set. No
 * arithmetic, no arbitrary calls, no free joins (member access past one level is
 * rejected — that's what forces `department_of(record.author)` instead of
 * `record.author.department`, which nothing here could safely turn into SQL).
 */
export function validateRowLevelExpr(expr: Expr, ctx: RowLevelContext): void {
  walk(expr);

  function walk(node: Expr): void {
    switch (node.kind) {
      case "literal":
        return;
      case "identifier":
        validateIdentifier(node.path, ctx);
        return;
      case "call": {
        if (!ROWLEVEL_RESOLVER_FUNCTIONS.has(node.name)) {
          throw new ExprValidationError(
            `"${node.name}" is not an allowed resolver function in a rowLevel expression`
          );
        }
        if (node.args.length !== 1) {
          throw new ExprValidationError(`${node.name}() takes exactly one argument`);
        }
        walk(node.args[0] as Expr);
        return;
      }
      case "unary":
        if (node.op !== "!") {
          throw new ExprValidationError(`arithmetic ("${node.op}") is not allowed in rowLevel expressions`);
        }
        walk(node.expr);
        return;
      case "binary": {
        const allowed: string[] = ["&&", "||", "==", "!=", "<", "<=", ">", ">=", "in"];
        if (!allowed.includes(node.op)) {
          throw new ExprValidationError(`operator "${node.op}" is not allowed in rowLevel expressions`);
        }
        walk(node.left);
        walk(node.right);
        return;
      }
      case "array":
        node.items.forEach(walk);
        return;
    }
  }
}

function validateIdentifier(path: string[], ctx: RowLevelContext): void {
  if (path[0] === "record") {
    if (path.length !== 2) {
      throw new ExprValidationError(
        `"record.${path.slice(1).join(".")}" is too deep — use a resolver function (e.g. department_of(record.${path[1]})) instead of dereferencing across entities`
      );
    }
    const field = path[1] as string;
    if (!ctx.entityFields.has(field)) {
      throw new UnknownFieldError(`unknown field "record.${field}"`);
    }
    return;
  }
  if (path[0] === "ctx" && path[1] === "user") {
    if (path.length !== 3 || !CTX_USER_FIELDS.has(path[2] as string)) {
      throw new ExprValidationError(`"ctx.user.${path.slice(2).join(".")}" is not a recognized field`);
    }
    return;
  }
  throw new ExprValidationError(`"${path.join(".")}" must start with "record." or "ctx.user."`);
}

/**
 * Compiles a validated rowLevel expression to a Postgres boolean SQL fragment, suitable
 * for use inside `CREATE POLICY ... USING (<here>)`.
 */
export function compileRowLevelToSql(expr: Expr): string {
  switch (expr.kind) {
    case "literal":
      return compileLiteral(expr.value);
    case "identifier":
      return compileIdentifier(expr.path);
    case "call":
      return `${expr.name}(${compileRowLevelToSql(expr.args[0] as Expr)})`;
    case "unary":
      return `(NOT ${compileRowLevelToSql(expr.expr)})`;
    case "binary":
      return compileBinary(expr.op, expr.left, expr.right);
    case "array":
      return `(${expr.items.map(compileRowLevelToSql).join(", ")})`;
  }
}

function compileLiteral(value: string | number | boolean): string {
  if (typeof value === "string") return quoteLiteral(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function compileIdentifier(path: string[]): string {
  if (path[0] === "record") {
    return quoteIdent(path[1] as string);
  }
  // ctx.user.* — NULLIF(..., '') matters: once a custom GUC name has been SET LOCAL
  // anywhere in a session's lifetime (even in an earlier, already-committed
  // transaction on a pooled connection), current_setting(..., true) returns '' for
  // "not currently set" instead of NULL for the rest of that connection's life, not
  // just NULL as you'd get on a connection where the name was never touched. Casting
  // '' to uuid throws instead of failing the RLS predicate closed, which is worse
  // than merely permissive — it's a 500, not a 403. NULLIF makes both cases behave
  // identically: no principal set → the predicate cannot match, not an error.
  switch (path[2]) {
    case "id":
      return "NULLIF(current_setting('factory.user_id', true), '')::uuid";
    case "department":
      return "NULLIF(current_setting('factory.department', true), '')::uuid";
    case "roles":
      return "string_to_array(NULLIF(current_setting('factory.roles', true), ''), ',')";
    default:
      throw new ExprValidationError(`unreachable: ctx.user.${path[2]}`);
  }
}

function compileBinary(op: string, left: Expr, right: Expr): string {
  if (op === "in") {
    const leftSql = compileRowLevelToSql(left);
    if (right.kind === "array") {
      return `(${leftSql} IN ${compileRowLevelToSql(right)})`;
    }
    // right is a set-valued expression, e.g. ctx.user.roles
    return `(${leftSql} = ANY(${compileRowLevelToSql(right)}))`;
  }
  const sqlOp = op === "==" ? "=" : op === "!=" ? "<>" : op === "&&" ? "AND" : op === "||" ? "OR" : op;
  return `(${compileRowLevelToSql(left)} ${sqlOp} ${compileRowLevelToSql(right)})`;
}

/** Convenience: parse + validate + compile in one call. */
export function compileRowLevelExpression(source: string, ctx: RowLevelContext): string {
  const expr = parseExpr(source);
  validateRowLevelExpr(expr, ctx);
  return compileRowLevelToSql(expr);
}
