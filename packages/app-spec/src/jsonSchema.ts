import { z } from "zod";
import { appSpecSchema } from "./schema.js";

let cached: object | undefined;

/**
 * JSON Schema view of the App Spec grammar (03_REPOSITORY's own description of this
 * package: "Spec スキーマ（Zod→JSON Schema）"). Consumers that don't want a TypeScript/Zod
 * dependency — an editor's autocomplete, or an LLM's structured-output constraint
 * (`@aiappfactory/ai-core`) — use this instead of the Zod schema directly.
 *
 * This is NECESSARILY a looser check than `validateAppSpec`: JSON Schema can express
 * types/enums/required-ness, but not the cross-field `superRefine` rules (reserved
 * words, `actor` fields needing `system: true`, referential integrity, ...). Something
 * that satisfies this schema can still fail `validateAppSpec` — that's expected, not a
 * bug; this schema exists to shape a first attempt, `validateAppSpec` remains the only
 * source of truth for whether a Spec is actually valid.
 */
export function getAppSpecJsonSchema(): object {
  cached ??= z.toJSONSchema(appSpecSchema, { target: "draft-7" });
  return cached;
}
