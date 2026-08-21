import type { AppSpec } from "@aiappfactory/app-spec";
import { entityTableDDL, indexStatements, referenceConstraints } from "./ddl.js";
import { roleNameFor, schemaNameFor } from "./naming.js";
import { entityRlsStatements } from "./rls.js";
import { schemaAndRoleStatements, tableGrantStatements } from "./roles.js";

export interface CompileOptions {
  /**
   * The app role's password. Generated and stored by the caller (Deploy Engine, via
   * `encrypted_secrets` — 02_SECURITY §7); spec-compiler never generates or persists
   * secrets itself, it only emits the SQL that sets one.
   */
  rolePassword: string;
}

export interface CompiledMigration {
  schemaName: string;
  roleName: string;
  /** Ordered SQL statements. Apply inside a single transaction — Postgres DDL is transactional. */
  statements: string[];
}

/**
 * Compiles a validated App Spec (already passed through `validateAppSpec`) to the
 * ordered SQL statements that provision its schema, role, tables, and RLS policies
 * (ADR-007). Run `PLATFORM_BOOTSTRAP_STATEMENTS` (platform.ts) once per cluster before
 * compiling any app — the resolver-function GRANTs here assume those functions exist.
 */
export function compileAppSpec(spec: AppSpec, opts: CompileOptions): CompiledMigration {
  const schemaName = schemaNameFor(spec.metadata.id);
  const roleName = roleNameFor(spec.metadata.id);

  const statements: string[] = [
    ...schemaAndRoleStatements(schemaName, roleName, opts.rolePassword),
    ...spec.data.entities.map((entity) => entityTableDDL(schemaName, entity)),
    ...spec.data.entities.flatMap((entity) => referenceConstraints(schemaName, entity)),
    ...spec.data.entities.flatMap((entity) => indexStatements(schemaName, entity)),
    ...tableGrantStatements(spec, schemaName, roleName),
    ...spec.data.entities.flatMap((entity) => entityRlsStatements(schemaName, entity, spec.access)),
  ];

  return { schemaName, roleName, statements };
}
