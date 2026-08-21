import type { BinaryOp, Expr } from "./ast.js";
import { ExprSyntaxError, type Token, tokenize } from "./lexer.js";

/**
 * Recursive-descent parser, precedence low → high:
 *   || < && < equality (==, !=) < relational (<, <=, >, >=, in) < additive (+, -)
 *   < multiplicative (*, /) < unary (!, -) < primary
 */
export function parseExpr(source: string): Expr {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (): Token => tokens[pos] as Token;
  const advance = (): Token => tokens[pos++] as Token;
  const expectPunct = (value: string): void => {
    const tok = peek();
    if (tok.type !== "punct" || tok.value !== value) {
      throw new ExprSyntaxError(`expected "${value}"`, tok.pos);
    }
    advance();
  };

  function parseOr(): Expr {
    let left = parseAnd();
    while (peek().type === "punct" && peek().value === "||") {
      advance();
      left = { kind: "binary", op: "||", left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd(): Expr {
    let left = parseEquality();
    while (peek().type === "punct" && peek().value === "&&") {
      advance();
      left = { kind: "binary", op: "&&", left, right: parseEquality() };
    }
    return left;
  }

  function parseEquality(): Expr {
    let left = parseRelational();
    while (peek().type === "punct" && (peek().value === "==" || peek().value === "!=")) {
      const op = advance().value as BinaryOp;
      left = { kind: "binary", op, left, right: parseRelational() };
    }
    return left;
  }

  function parseRelational(): Expr {
    let left = parseAdditive();
    while (
      (peek().type === "punct" && ["<", "<=", ">", ">="].includes(peek().value)) ||
      (peek().type === "ident" && peek().value === "in")
    ) {
      const tok = advance();
      const op = (tok.type === "ident" ? "in" : tok.value) as BinaryOp;
      left = { kind: "binary", op, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive(): Expr {
    let left = parseMultiplicative();
    while (peek().type === "punct" && (peek().value === "+" || peek().value === "-")) {
      const op = advance().value as BinaryOp;
      left = { kind: "binary", op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative(): Expr {
    let left = parseUnary();
    while (peek().type === "punct" && (peek().value === "*" || peek().value === "/")) {
      const op = advance().value as BinaryOp;
      left = { kind: "binary", op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (peek().type === "punct" && (peek().value === "!" || peek().value === "-")) {
      const op = advance().value as "!" | "-";
      return { kind: "unary", op, expr: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Expr {
    const tok = peek();

    if (tok.type === "number") {
      advance();
      return { kind: "literal", value: Number(tok.value) };
    }

    if (tok.type === "string") {
      advance();
      return { kind: "literal", value: tok.value };
    }

    if (tok.type === "punct" && tok.value === "(") {
      advance();
      const inner = parseOr();
      expectPunct(")");
      return inner;
    }

    if (tok.type === "punct" && tok.value === "[") {
      advance();
      const items: Expr[] = [];
      if (!(peek().type === "punct" && peek().value === "]")) {
        items.push(parseOr());
        while (peek().type === "punct" && peek().value === ",") {
          advance();
          items.push(parseOr());
        }
      }
      expectPunct("]");
      return { kind: "array", items };
    }

    if (tok.type === "ident") {
      if (tok.value === "true" || tok.value === "false") {
        advance();
        return { kind: "literal", value: tok.value === "true" };
      }

      advance();
      const path = [tok.value];

      // function call: ident immediately followed by "("
      if (peek().type === "punct" && peek().value === "(") {
        advance();
        const args: Expr[] = [];
        if (!(peek().type === "punct" && peek().value === ")")) {
          args.push(parseOr());
          while (peek().type === "punct" && peek().value === ",") {
            advance();
            args.push(parseOr());
          }
        }
        expectPunct(")");
        return { kind: "call", name: tok.value, args };
      }

      // member access: a.b.c
      while (peek().type === "punct" && peek().value === ".") {
        advance();
        const member = peek();
        if (member.type !== "ident") {
          throw new ExprSyntaxError("expected identifier after \".\"", member.pos);
        }
        advance();
        path.push(member.value);
      }
      return { kind: "identifier", path };
    }

    throw new ExprSyntaxError(`unexpected token "${tok.value || "<eof>"}"`, tok.pos);
  }

  const result = parseOr();
  if (peek().type !== "eof") {
    throw new ExprSyntaxError(`unexpected trailing input "${peek().value}"`, peek().pos);
  }
  return result;
}
