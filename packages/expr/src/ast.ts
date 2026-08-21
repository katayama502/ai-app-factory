/**
 * AST for the restricted expression grammar (ADR-010 / ADR-011).
 *
 * This grammar is intentionally NOT Turing-complete: no loops, no user-defined
 * functions, no arbitrary calls, no assignment. It exists to be compiled to SQL
 * (a `USING` clause for RLS, or a `GENERATED ALWAYS AS` column) — never to be
 * executed as a general-purpose interpreter. If a construct can't be expressed
 * safely in SQL, it does not belong in this grammar.
 */

export type BinaryOp =
  | "&&"
  | "||"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "in";

export type Expr =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "identifier"; path: string[] }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "unary"; op: "!" | "-"; expr: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "array"; items: Expr[] };
