export type TokenType =
  | "number"
  | "string"
  | "ident"
  | "punct"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class ExprSyntaxError extends Error {
  constructor(
    message: string,
    public readonly pos: number
  ) {
    super(`${message} (at position ${pos})`);
    this.name = "ExprSyntaxError";
  }
}

const PUNCTUATION_2 = ["==", "!=", "<=", ">=", "&&", "||"];
const PUNCTUATION_1 = ["(", ")", ",", ".", "[", "]", "!", "<", ">", "+", "-", "*", "/"];

/** Tokenizes a restricted expression string. Throws ExprSyntaxError on any unrecognized input. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === undefined) break;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = "";
      while (i < source.length && source[i] !== quote) {
        value += source[i];
        i++;
      }
      if (source[i] !== quote) {
        throw new ExprSyntaxError("unterminated string literal", start);
      }
      i++;
      tokens.push({ type: "string", value, pos: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      let value = "";
      while (i < source.length && /[0-9.]/.test(source[i] ?? "")) {
        value += source[i];
        i++;
      }
      tokens.push({ type: "number", value, pos: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      let value = "";
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i] ?? "")) {
        value += source[i];
        i++;
      }
      tokens.push({ type: "ident", value, pos: start });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (PUNCTUATION_2.includes(two)) {
      tokens.push({ type: "punct", value: two, pos: i });
      i += 2;
      continue;
    }

    if (PUNCTUATION_1.includes(ch)) {
      tokens.push({ type: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    throw new ExprSyntaxError(`unexpected character "${ch}"`, i);
  }

  tokens.push({ type: "eof", value: "", pos: source.length });
  return tokens;
}
