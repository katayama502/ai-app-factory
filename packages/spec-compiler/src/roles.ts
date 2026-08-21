import type { AppSpec } from "@aiappfactory/app-spec";
import { quoteIdent, quoteLiteral } from "@aiappfactory/expr";
import { RESOLVER_FUNCTION_SIGNATURES } from "./platform.js";

const SQL_COMMANDS_BY_GRANT_PREFIX: Record<string, "SELECT" | "INSERT" | "UPDATE" | "DELETE"> = {
  create: "INSERT",
  read: "SELECT",
  update: "UPDATE",
  delete: "DELETE",
};

/** Every base SQL command implied by any role's grants, across the whole Spec — the base GRANT has to be broad enough for the most-privileged role; RLS policies (rls.ts) narrow it back down per role at query time. */
function neededCommands(spec: AppSpec): Set<"SELECT" | "INSERT" | "UPDATE" | "DELETE"> {
  const commands = new Set<"SELECT" | "INSERT" | "UPDATE" | "DELETE">();
  for (const roleGrant of spec.access.roles) {
    for (const grant of roleGrant.grants) {
      const prefix = grant.split(":")[0] as string;
      const command = SQL_COMMANDS_BY_GRANT_PREFIX[prefix];
      if (command) commands.add(command);
    }
  }
  return commands;
}

/**
 * Schema + role creation for one app (ADR-007). The role gets:
 *   - USAGE + full DML on its own schema's tables (narrowed per-row by RLS, see rls.ts)
 *   - USAGE on `public` + EXECUTE on the two resolver functions ONLY — not SELECT on
 *     `public.users`/`public.departments` themselves. This is the one place this
 *     compiler deliberately goes further than the literal `REVOKE ALL ON SCHEMA public`
 *     in 01_ARCHITECTURE §7.1: that line alone would also block resolver-function
 *     calls, since Postgres requires schema USAGE to resolve ANY reference into a
 *     schema, even a fully-qualified function call. Granting USAGE + narrow EXECUTE
 *     keeps the underlying Control Plane tables unreadable while still letting
 *     `department_of()` do its job.
 */
export function schemaAndRoleStatements(schemaName: string, roleName: string, rolePassword: string): string[] {
  const statements = [
    `CREATE SCHEMA ${quoteIdent(schemaName)}`,
    `CREATE ROLE ${quoteIdent(roleName)} LOGIN PASSWORD ${quoteLiteral(rolePassword)}`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(schemaName)} TO ${quoteIdent(roleName)}`,
    `REVOKE ALL ON SCHEMA public FROM ${quoteIdent(roleName)}`,
    `GRANT USAGE ON SCHEMA public TO ${quoteIdent(roleName)}`,
  ];

  for (const signature of RESOLVER_FUNCTION_SIGNATURES) {
    statements.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${quoteIdent(roleName)}`);
  }

  statements.push(`ALTER ROLE ${quoteIdent(roleName)} SET search_path = ${quoteIdent(schemaName)}`);

  return statements;
}

/** Per-table GRANTs — must run AFTER `CREATE TABLE`, so these are emitted as a separate phase (see compile.ts ordering). */
export function tableGrantStatements(spec: AppSpec, schemaName: string, roleName: string): string[] {
  const commands = [...neededCommands(spec)];
  if (commands.length === 0) return [];
  return spec.data.entities.map(
    (entity) =>
      `GRANT ${commands.join(", ")} ON ${quoteIdent(schemaName)}.${quoteIdent(entity.name)} TO ${quoteIdent(roleName)}`
  );
}
