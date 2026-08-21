import { createHash } from "node:crypto";
import { type AppSpec, appSpecSchema } from "./schema.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; spec: AppSpec; specHash: string }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validates raw input against the App Spec schema AND checks referential integrity
 * (entity/field/role references that Zod's per-field validation cannot see across
 * the whole document). This is Gate 0 (02_SECURITY §4.2) in library form — the
 * Security Gate service calls this before running policy/secret/etc. checks.
 */
export function validateAppSpec(input: unknown): ValidationResult {
  const parsed = appSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const issues = checkReferentialIntegrity(parsed.data);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, spec: parsed.data, specHash: hashAppSpec(parsed.data) };
}

function checkReferentialIntegrity(spec: AppSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const entitiesByName = new Map(spec.data.entities.map((e) => [e.name, e]));
  const entityNames = new Set(entitiesByName.keys());

  // duplicate entity names
  const seenEntities = new Set<string>();
  spec.data.entities.forEach((e, i) => {
    if (seenEntities.has(e.name)) {
      issues.push({ path: `data.entities[${i}].name`, message: `duplicate entity name "${e.name}"` });
    }
    seenEntities.add(e.name);
  });

  const fieldsOf = (entityName: string): Set<string> => {
    const entity = entitiesByName.get(entityName);
    return new Set([
      "id",
      "createdAt",
      "updatedAt",
      ...(entity?.fields.map((f) => f.name) ?? []),
      ...(entity?.computed?.map((c) => c.name) ?? []),
    ]);
  };

  // reference fields must point at a real entity
  for (const entity of spec.data.entities) {
    for (const [i, field] of entity.fields.entries()) {
      if (field.type === "reference" && field.references && !entityNames.has(field.references)) {
        issues.push({
          path: `data.entities[${entity.name}].fields[${i}].references`,
          message: `references unknown entity "${field.references}"`,
        });
      }
    }
  }

  const roleNames = new Set(spec.access.roles.map((r) => r.role));

  // ui.pages: entity + field references
  spec.ui.pages.forEach((page, i) => {
    const path = `ui.pages[${i}]`;
    if (page.type === "form" || page.type === "list" || page.type === "detail" || page.type === "import") {
      if (!entityNames.has(page.entity)) {
        issues.push({ path: `${path}.entity`, message: `unknown entity "${page.entity}"` });
        return;
      }
    }
    if (page.type === "list") {
      const known = fieldsOf(page.entity);
      for (const col of page.columns) {
        if (!known.has(col)) issues.push({ path: `${path}.columns`, message: `unknown field "${col}" on ${page.entity}` });
      }
      for (const s of page.search ?? []) {
        if (!known.has(s)) issues.push({ path: `${path}.search`, message: `unknown field "${s}" on ${page.entity}` });
      }
    }
    if (page.type === "dashboard") {
      page.widgets.forEach((w, wi) => {
        if (!entityNames.has(w.entity)) {
          issues.push({ path: `${path}.widgets[${wi}].entity`, message: `unknown entity "${w.entity}"` });
          return;
        }
        if (w.field && !fieldsOf(w.entity).has(w.field)) {
          issues.push({ path: `${path}.widgets[${wi}].field`, message: `unknown field "${w.field}" on ${w.entity}` });
        }
      });
    }
  });

  // automations: entity + role references
  spec.automations.forEach((auto, i) => {
    const path = `automations[${i}]`;
    if (!entityNames.has(auto.trigger.entity)) {
      issues.push({ path: `${path}.trigger.entity`, message: `unknown entity "${auto.trigger.entity}"` });
    }
    for (const [ai, action] of auto.actions.entries()) {
      if (action.type === "notify" && action.to.startsWith("role:")) {
        const role = action.to.slice("role:".length);
        if (!roleNames.has(role)) {
          issues.push({ path: `${path}.actions[${ai}].to`, message: `unknown role "${role}"` });
        }
      }
    }
  });

  // ai.features: entity + field references
  spec.ai.features.forEach((feature, i) => {
    const path = `ai.features[${i}]`;
    if (!entityNames.has(feature.entity)) {
      issues.push({ path: `${path}.entity`, message: `unknown entity "${feature.entity}"` });
      return;
    }
    if (!fieldsOf(feature.entity).has(feature.field)) {
      issues.push({ path: `${path}.field`, message: `unknown field "${feature.field}" on ${feature.entity}` });
    }
  });

  // access.rowLevel keys should be referenced by at least one grant (e.g. "own", "dept")
  // — this is advisory, not fatal: unused rowLevel definitions are dead config, not a security issue.

  return issues;
}

/**
 * Canonical JSON + SHA-256 (ADR-005). Used as `app_versions.spec_hash` so identical
 * Specs always hash identically regardless of key order.
 */
export function hashAppSpec(spec: AppSpec): string {
  const canonical = canonicalize(spec);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
