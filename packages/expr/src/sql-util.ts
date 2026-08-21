/** Double-quotes a Postgres identifier, escaping embedded quotes. Never accepts interpolation of untrusted runtime values — identifiers here always come from the App Spec, which is already schema-validated. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quotes a SQL string literal, escaping embedded quotes. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
