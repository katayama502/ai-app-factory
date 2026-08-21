/**
 * Derives the per-app Postgres schema/role names from the Spec's kebab-case `metadata.id`
 * (ADR-007). Postgres allows dashes in quoted identifiers, but role names in particular are
 * far less error-prone unquoted — so we normalize to snake_case once, here, rather than
 * quoting inconsistently across every statement.
 */
export function schemaNameFor(appId: string): string {
  return `app_${appId.replace(/-/g, "_")}`;
}

export function roleNameFor(appId: string): string {
  return `${schemaNameFor(appId)}_rw`;
}
