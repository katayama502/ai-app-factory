import type { EntitySpec, FieldSpec, FieldType } from "@aiappfactory/app-spec";
import { type Expr, compileComputedExpression, parseExpr, quoteIdent, quoteLiteral } from "@aiappfactory/expr";

/** Maps an App Spec field type to its Postgres column type (04_IMPLEMENTATION §3 E1-4 type set). */
function sqlType(field: FieldSpec): string {
  switch (field.type) {
    case "string":
      return field.maxLength ? `VARCHAR(${field.maxLength})` : "TEXT";
    case "text":
    case "richtext":
      return "TEXT";
    case "number":
    case "decimal":
      return "NUMERIC";
    case "date":
      return "DATE";
    case "datetime":
      return "TIMESTAMPTZ";
    case "boolean":
      return "BOOLEAN";
    case "select":
      return "TEXT";
    case "multiselect":
      return "TEXT[]";
    case "file":
      return "TEXT";
    case "reference":
    case "actor":
      return "UUID";
  }
}

function defaultClause(field: FieldSpec): string | null {
  if (field.default === undefined) return null;
  if (field.default === null) return "NULL";
  if (field.type === "date" && field.default === "today") return "CURRENT_DATE";
  if (field.type === "datetime" && field.default === "now") return "now()";
  if (typeof field.default === "string") return quoteLiteral(field.default);
  if (typeof field.default === "boolean") return field.default ? "TRUE" : "FALSE";
  return String(field.default);
}

function columnChecks(field: FieldSpec): string[] {
  const checks: string[] = [];
  const col = quoteIdent(field.name);
  if (field.type === "select" && field.options && field.options.length > 0) {
    checks.push(`${col} IS NULL OR ${col} IN (${field.options.map(quoteLiteral).join(", ")})`);
  }
  if (field.type === "multiselect" && field.options && field.options.length > 0) {
    checks.push(`${col} IS NULL OR ${col} <@ ARRAY[${field.options.map(quoteLiteral).join(", ")}]::text[]`);
  }
  if (field.type === "string" || field.type === "text" || field.type === "richtext") {
    if (field.maxLength && field.type !== "string") {
      // VARCHAR(n) already enforces length for `string`; text/richtext have no native cap.
      checks.push(`char_length(${col}) <= ${field.maxLength}`);
    }
  }
  if (field.min !== undefined && (field.type === "number" || field.type === "decimal")) {
    checks.push(`${col} >= ${field.min}`);
  }
  if (field.max !== undefined && (field.type === "number" || field.type === "decimal")) {
    checks.push(`${col} <= ${field.max}`);
  }
  return checks;
}

function columnDefinition(field: FieldSpec): string {
  const parts = [quoteIdent(field.name), sqlType(field)];
  if (field.required || field.type === "actor") parts.push("NOT NULL");
  const def = defaultClause(field);
  if (def) parts.push(`DEFAULT ${def}`);
  for (const check of columnChecks(field)) {
    parts.push(`CHECK (${check})`);
  }
  return parts.join(" ");
}

/** Result type used for a computed (`GENERATED ALWAYS AS`) column's SQL type. */
type ComputedSqlType = "BOOLEAN" | "NUMERIC" | "TEXT";

function inferComputedType(expr: Expr, fieldTypes: ReadonlyMap<string, ComputedSqlType>): ComputedSqlType {
  switch (expr.kind) {
    case "literal":
      if (typeof expr.value === "string") return "TEXT";
      if (typeof expr.value === "boolean") return "BOOLEAN";
      return "NUMERIC";
    case "identifier":
      return fieldTypes.get(expr.path[0] as string) ?? "TEXT";
    case "unary":
      return expr.op === "!" ? "BOOLEAN" : "NUMERIC";
    case "binary":
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(expr.op)) return "BOOLEAN";
      return "NUMERIC";
    case "call":
    case "array":
      // Rejected by validateComputedExpr before we get here.
      throw new Error(`unreachable: cannot infer type of expr.kind === "${expr.kind}"`);
  }
}

function baseSqlTypeFor(type: FieldType): ComputedSqlType {
  switch (type) {
    case "boolean":
      return "BOOLEAN";
    case "number":
    case "decimal":
      return "NUMERIC";
    default:
      return "TEXT";
  }
}

/**
 * Generates `CREATE TABLE` (plus computed `GENERATED` columns) for one entity. Foreign
 * keys for `reference` fields are emitted separately (`referenceConstraints`) so entity
 * ordering in the Spec never matters — a table can reference another defined later.
 */
export function entityTableDDL(schemaName: string, entity: EntitySpec): string {
  const columns = [
    `"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
    `"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    `"deletedAt" TIMESTAMPTZ`, // soft delete by default — 04_IMPLEMENTATION §12 R-11
    ...entity.fields.map(columnDefinition),
  ];

  const fieldTypes = new Map<string, ComputedSqlType>(entity.fields.map((f) => [f.name, baseSqlTypeFor(f.type)]));
  for (const computed of entity.computed ?? []) {
    const expr = parseExpr(computed.expr);
    const sql = compileComputedExpression(computed.expr, { entityFields: new Set(entity.fields.map((f) => f.name)) });
    const type = inferComputedType(expr, fieldTypes);
    fieldTypes.set(computed.name, type);
    columns.push(`${quoteIdent(computed.name)} ${type} GENERATED ALWAYS AS (${sql}) STORED`);
  }

  return `CREATE TABLE ${quoteIdent(schemaName)}.${quoteIdent(entity.name)} (\n  ${columns.join(",\n  ")}\n)`;
}

export function referenceConstraints(schemaName: string, entity: EntitySpec): string[] {
  const statements: string[] = [];
  for (const field of entity.fields) {
    if (field.type === "reference" && field.references) {
      statements.push(
        `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(entity.name)} ` +
          `ADD CONSTRAINT ${quoteIdent(`fk_${entity.name}_${field.name}`)} ` +
          `FOREIGN KEY (${quoteIdent(field.name)}) REFERENCES ${quoteIdent(schemaName)}.${quoteIdent(field.references)}("id")`
      );
    }
  }
  return statements;
}

export function indexStatements(schemaName: string, entity: EntitySpec): string[] {
  return entity.fields
    .filter((f) => f.index)
    .map(
      (f) =>
        `CREATE INDEX ${quoteIdent(`idx_${entity.name}_${f.name}`)} ON ${quoteIdent(schemaName)}.${quoteIdent(entity.name)} (${quoteIdent(f.name)})`
    );
}
