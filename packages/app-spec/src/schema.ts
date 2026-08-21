import { z } from "zod";

/**
 * App Spec v0 schema (ADR-005: YAML for humans, JSON internally, canonicalized + hashed).
 * This is the ONLY vocabulary a generated app can use (01_ARCHITECTURE §1.2).
 * Anything not expressible here cannot be declared — that is the security property,
 * not a limitation to work around.
 */

export const SPEC_API_VERSION = "factory.dev/v1" as const;

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** kebab-case, used for app id / template dir name / subdomain slug (ADR-012). */
export const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/, "must be kebab-case (a-z, 0-9, -), start with a letter");

/** PascalCase, used for entity names. */
export const entityNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][a-zA-Z0-9]*$/, "entity name must be PascalCase");

/** camelCase, used for field/automation-id names. */
export const identifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, "must be camelCase");

/**
 * snake_case, used for role names — these map 1:1 to Keycloak client roles
 * (01_ARCHITECTURE §9.2), where snake_case is the prevailing convention.
 */
export const roleNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "must be snake_case");

/**
 * Reserved words a Spec author may never use as a field or entity name.
 * Gate 0 (02_SECURITY §4.2) treats use of these as a forbidden declaration.
 */
export const RESERVED_WORDS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "ctx",
  "system",
  "actor",
  "__proto__",
  "constructor",
  "prototype",
]);

// ---------------------------------------------------------------------------
// Data classification (01_ARCHITECTURE §1.4, 02_SECURITY §2.2)
// ---------------------------------------------------------------------------

export const classificationSchema = z.enum([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "PERSONAL",
  "HIGHLY_CONFIDENTIAL",
]);
export type Classification = z.infer<typeof classificationSchema>;

/** ISO-8601 duration, e.g. P3Y, P90D. Used for `retention` (declared only in v1.0 — see 01 §13). */
const isoDurationSchema = z
  .string()
  .regex(/^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/, "must be an ISO-8601 duration");

// ---------------------------------------------------------------------------
// Generation tier (01_ARCHITECTURE §1.3)
// ---------------------------------------------------------------------------

export const tierSchema = z.enum(["T1", "T2", "T3"]);
export type Tier = z.infer<typeof tierSchema>;

// ---------------------------------------------------------------------------
// Fields (01_ARCHITECTURE §1.4; type set frozen per 04_IMPLEMENTATION §3 E1-4)
// ---------------------------------------------------------------------------

export const fieldTypeSchema = z.enum([
  "string",
  "text",
  "richtext",
  "number",
  "decimal",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "file",
  "reference",
  "actor",
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const fieldSchema = z
  .object({
    name: identifierSchema,
    type: fieldTypeSchema,
    label: z.string().min(1),
    required: z.boolean().optional(),
    /** Only `system: true` fields may use a defaulting mechanism outside user input (e.g. `actor`). */
    system: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    index: z.boolean().optional(),
    /** Required when type === 'select' | 'multiselect'. */
    options: z.array(z.string()).optional(),
    /** Required when type === 'reference'. Must name another entity in the same Spec. */
    references: entityNameSchema.optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (RESERVED_WORDS.has(field.name)) {
      ctx.addIssue({
        code: "custom",
        message: `field name "${field.name}" is reserved`,
        path: ["name"],
      });
    }
    if (field.type === "actor" && field.system !== true) {
      ctx.addIssue({
        code: "custom",
        message: '"actor" fields must declare system: true — they are injected by the runtime, never user input',
        path: ["system"],
      });
    }
    if ((field.type === "select" || field.type === "multiselect") && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: `type "${field.type}" requires a non-empty "options" array`,
        path: ["options"],
      });
    }
    if (field.type === "reference" && !field.references) {
      ctx.addIssue({
        code: "custom",
        message: 'type "reference" requires "references": <EntityName>',
        path: ["references"],
      });
    }
  });
export type FieldSpec = z.infer<typeof fieldSchema>;

/**
 * T2: a restricted expression (§1.3). NOT arbitrary code — evaluated by a sandboxed
 * expression evaluator (ADR-010) with a hard time/memory budget. The expression
 * grammar itself is validated at a later stage (packages/expr), not here.
 */
export const computedFieldSchema = z
  .object({
    name: identifierSchema,
    expr: z.string().min(1).max(2000),
  })
  .strict();

export const entitySchema = z
  .object({
    name: entityNameSchema,
    label: z.string().min(1),
    classification: classificationSchema,
    retention: isoDurationSchema.optional(),
    fields: z.array(fieldSchema).min(1),
    computed: z.array(computedFieldSchema).optional(),
  })
  .strict()
  .superRefine((entity, ctx) => {
    const fieldNames = new Set<string>();
    for (const [i, f] of entity.fields.entries()) {
      if (fieldNames.has(f.name)) {
        ctx.addIssue({ code: "custom", message: `duplicate field name "${f.name}"`, path: ["fields", i, "name"] });
      }
      fieldNames.add(f.name);
    }
    for (const [i, c] of (entity.computed ?? []).entries()) {
      if (fieldNames.has(c.name)) {
        ctx.addIssue({
          code: "custom",
          message: `computed field "${c.name}" collides with a stored field name`,
          path: ["computed", i, "name"],
        });
      }
    }
  });
export type EntitySpec = z.infer<typeof entitySchema>;

// ---------------------------------------------------------------------------
// UI pages (page types frozen at 4 + import per 04_IMPLEMENTATION §3 E1-4 / §9 E7-4)
// ---------------------------------------------------------------------------

const widgetTypeSchema = z.enum(["stat", "bar", "line", "pie", "table"]);

const dashboardWidgetSchema = z
  .object({
    type: widgetTypeSchema,
    entity: entityNameSchema,
    aggregate: z.enum(["count", "sum", "avg", "min", "max"]).optional(),
    field: identifierSchema.optional(),
    groupBy: z.string().optional(),
    period: z.enum(["today", "thisWeek", "thisMonth", "thisYear", "all"]).optional(),
  })
  .strict();

const formPageSchema = z
  .object({
    type: z.literal("form"),
    entity: entityNameSchema,
    title: z.string().min(1),
  })
  .strict();

const listPageSchema = z
  .object({
    type: z.literal("list"),
    entity: entityNameSchema,
    columns: z.array(identifierSchema).min(1),
    search: z.array(identifierSchema).optional(),
    sort: z.string().optional(),
  })
  .strict();

const detailPageSchema = z
  .object({
    type: z.literal("detail"),
    entity: entityNameSchema,
    title: z.string().min(1).optional(),
  })
  .strict();

const dashboardPageSchema = z
  .object({
    type: z.literal("dashboard"),
    title: z.string().min(1),
    widgets: z.array(dashboardWidgetSchema).min(1),
  })
  .strict();

const importPageSchema = z
  .object({
    type: z.literal("import"),
    entity: entityNameSchema,
    title: z.string().min(1),
    formats: z.array(z.enum(["csv", "xlsx"])).min(1),
    maxRows: z.number().int().positive().max(1_000_000),
    dryRun: z.boolean(),
  })
  .strict();

export const pageSchema = z.discriminatedUnion("type", [
  formPageSchema,
  listPageSchema,
  detailPageSchema,
  dashboardPageSchema,
  importPageSchema,
]);
export type PageSpec = z.infer<typeof pageSchema>;

// ---------------------------------------------------------------------------
// Access (01_ARCHITECTURE §1.4; row-level DSL restricted per ADR-011)
// ---------------------------------------------------------------------------

const grantSchema = z.enum([
  "create",
  "read",
  "read:own",
  "read:dept",
  "update",
  "update:own",
  "update:dept",
  "delete",
  "delete:own",
  "export",
]);

const roleGrantSchema = z
  .object({
    role: roleNameSchema,
    grants: z.array(grantSchema).min(1),
  })
  .strict();

/**
 * `rowLevel` values are NOT general CEL — they must be mechanically translatable to a
 * PostgreSQL RLS predicate (ADR-011 / 01_ARCHITECTURE §7.1). Only a restricted grammar
 * is allowed; full parsing/validation happens in packages/spec-compiler, but we bound
 * the character set and length here so obviously-invalid input fails fast.
 */
const rowLevelExprSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^[a-zA-Z0-9_.()\s"'!&|=<>]+$/,
    "rowLevel expressions may only use comparisons, &&/||/!, record/ctx.user fields, and resolver calls"
  );

export const accessSchema = z
  .object({
    roles: z.array(roleGrantSchema).min(1),
    rowLevel: z.record(z.string(), rowLevelExprSchema).optional(),
  })
  .strict()
  .superRefine((access, ctx) => {
    const roleNames = new Set<string>();
    for (const [i, r] of access.roles.entries()) {
      if (roleNames.has(r.role)) {
        ctx.addIssue({ code: "custom", message: `duplicate role "${r.role}"`, path: ["roles", i, "role"] });
      }
      roleNames.add(r.role);
    }
  });
export type AccessSpec = z.infer<typeof accessSchema>;

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

const notifyActionSchema = z
  .object({
    type: z.literal("notify"),
    channel: z.enum(["email", "webhook"]),
    to: z.string().min(1),
    template: z.string().min(1),
  })
  .strict();

const webhookActionSchema = z
  .object({
    type: z.literal("webhook"),
    name: identifierSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const automationActionSchema = z.discriminatedUnion("type", [notifyActionSchema, webhookActionSchema]);

export const automationSchema = z
  .object({
    id: identifierSchema,
    trigger: z
      .object({
        on: z.enum(["create", "update", "delete"]),
        entity: entityNameSchema,
      })
      .strict(),
    when: z.string().max(500).optional(),
    actions: z.array(automationActionSchema).min(1),
  })
  .strict();
export type AutomationSpec = z.infer<typeof automationSchema>;

// ---------------------------------------------------------------------------
// AI features (all traffic must go through AI Gateway — 01_ARCHITECTURE §4)
// ---------------------------------------------------------------------------

const aiFeatureSchema = z
  .object({
    id: identifierSchema,
    type: z.enum(["summarize", "classify", "extract", "draft"]),
    entity: entityNameSchema,
    field: identifierSchema,
    policy: z
      .object({
        allowExternal: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const aiSchema = z
  .object({
    features: z.array(aiFeatureSchema).default([]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Network (deny-by-default egress — 01_ARCHITECTURE §1.4 / §7.2)
// ---------------------------------------------------------------------------

/** Internal/loopback ranges a Spec must never declare (Gate 0 hard-block, T-04). */
const FORBIDDEN_EGRESS_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^localhost$/i,
  /\.internal$/i,
  /\.local$/i,
];

const egressHostSchema = z
  .string()
  .min(1)
  .max(253)
  .superRefine((host, ctx) => {
    for (const pattern of FORBIDDEN_EGRESS_PATTERNS) {
      if (pattern.test(host)) {
        ctx.addIssue({
          code: "custom",
          message: `egress host "${host}" resolves to an internal/reserved range and can never be declared (SSRF risk, T-04)`,
        });
        return;
      }
    }
  });

export const networkSchema = z
  .object({
    egress: z.array(egressHostSchema).default([]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Root App Spec
// ---------------------------------------------------------------------------

export const metadataSchema = z
  .object({
    id: slugSchema,
    name: z.string().min(1).max(200),
    owner: z.string().min(1),
    tier: tierSchema,
  })
  .strict();

export const appSpecSchema = z
  .object({
    apiVersion: z.literal(SPEC_API_VERSION),
    kind: z.literal("App"),
    metadata: metadataSchema,
    data: z
      .object({
        entities: z.array(entitySchema).min(1),
      })
      .strict(),
    ui: z
      .object({
        pages: z.array(pageSchema).min(1),
      })
      .strict(),
    access: accessSchema,
    automations: z.array(automationSchema).default([]),
    ai: aiSchema.default({ features: [] }),
    network: networkSchema.default({ egress: [] }),
  })
  .strict();

export type AppSpec = z.infer<typeof appSpecSchema>;
