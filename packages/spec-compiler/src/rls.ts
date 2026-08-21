import type { AccessSpec, EntitySpec } from "@aiappfactory/app-spec";
import { UnknownFieldError, compileRowLevelExpression, quoteIdent, quoteLiteral } from "@aiappfactory/expr";

type SqlCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
type Scope = "own" | "dept" | undefined;

interface GrantMapping {
  command: SqlCommand;
  scope: Scope;
}

/** Maps one `access.roles[].grants[]` entry to the SQL command (if any) it authorizes. `export` has no RLS meaning — it's an app-layer permission, enforced by the API, not the database. */
function mapGrant(grant: string): GrantMapping | null {
  switch (grant) {
    case "create":
      return { command: "INSERT", scope: undefined };
    case "read":
      return { command: "SELECT", scope: undefined };
    case "read:own":
      return { command: "SELECT", scope: "own" };
    case "read:dept":
      return { command: "SELECT", scope: "dept" };
    case "update":
      return { command: "UPDATE", scope: undefined };
    case "update:own":
      return { command: "UPDATE", scope: "own" };
    case "update:dept":
      return { command: "UPDATE", scope: "dept" };
    case "delete":
      return { command: "DELETE", scope: undefined };
    case "delete:own":
      return { command: "DELETE", scope: "own" };
    case "export":
      return null;
    default:
      return null;
  }
}

// NULLIF(...,'') for the same reason as @aiappfactory/expr's ctx.user.* compilation —
// a pooled connection's custom GUC placeholder reads as '' once touched, not NULL.
const ROLE_MEMBERSHIP_SQL = (role: string): string =>
  `${quoteLiteral(role)} = ANY(string_to_array(NULLIF(current_setting('factory.roles', true), ''), ','))`;

/**
 * Builds one branch of an OR'd RLS predicate: "this session has role X, AND (row-level
 * condition for X's grant, or unconditionally true if the grant carries no scope)".
 *
 * Returns `null` when the rule structurally cannot apply to this entity — e.g. an
 * `own` rule written as `record.reservedBy == ctx.user.id` on an app whose OTHER
 * entity has no `reservedBy` field. Since `access` is one block shared across every
 * entity in the app (ADR-007), this is expected, not an error: it just means role X
 * gets no access via *this* scoped grant on *this* entity. A genuinely undefined
 * `access.rowLevel.<scope>` (never provided for ANY entity) still throws — that is a
 * real Spec authoring mistake, not a per-entity non-applicability.
 */
function branchSql(role: string, scope: Scope, access: AccessSpec, entity: EntitySpec): string | null {
  const membership = ROLE_MEMBERSHIP_SQL(role);
  if (!scope) {
    return `(${membership})`;
  }
  const rowLevelExpr = access.rowLevel?.[scope];
  if (!rowLevelExpr) {
    throw new Error(`role "${role}" grants a ":${scope}" permission but access.rowLevel.${scope} is not defined`);
  }
  try {
    const compiled = compileRowLevelExpression(rowLevelExpr, {
      entityFields: new Set(entity.fields.map((f) => f.name)),
    });
    return `(${membership} AND ${compiled})`;
  } catch (error) {
    if (error instanceof UnknownFieldError) {
      return null;
    }
    throw new Error(
      `entity "${entity.name}": access.rowLevel.${scope} ("${rowLevelExpr}") is invalid for role "${role}": ${(error as Error).message}`
    );
  }
}

/**
 * Generates `ENABLE`/`FORCE ROW LEVEL SECURITY` plus one `CREATE POLICY` per SQL command
 * that at least one role can perform (04_IMPLEMENTATION E1-2, ADR-007). A command with no
 * policy is denied to everyone — Postgres' own default-deny under RLS, no extra code needed.
 */
export function entityRlsStatements(schemaName: string, entity: EntitySpec, access: AccessSpec): string[] {
  const table = `${quoteIdent(schemaName)}.${quoteIdent(entity.name)}`;
  const statements = [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`];

  const byCommand = new Map<SqlCommand, string[]>();
  for (const roleGrant of access.roles) {
    for (const grant of roleGrant.grants) {
      const mapping = mapGrant(grant);
      if (!mapping) continue;
      const branch = branchSql(roleGrant.role, mapping.scope, access, entity);
      if (branch === null) continue;
      const branches = byCommand.get(mapping.command) ?? [];
      branches.push(branch);
      byCommand.set(mapping.command, branches);
    }
  }

  for (const [command, branches] of byCommand) {
    const predicate = branches.join("\n    OR ");
    const policyName = quoteIdent(`${entity.name}_${command.toLowerCase()}`);
    const clause = command === "INSERT" ? "WITH CHECK" : "USING";
    statements.push(
      `CREATE POLICY ${policyName} ON ${table} FOR ${command} ${clause} (\n    ${predicate}\n  )`
    );
  }

  return statements;
}
