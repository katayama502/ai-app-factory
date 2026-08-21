import { parse as parseYamlDocument } from "yaml";
import { type ValidationResult, validateAppSpec } from "./validate.js";

/** Parses a Spec written in YAML (the human-facing format, ADR-005) and validates it. */
export function parseAppSpecYaml(source: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(source);
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: "", message: `YAML parse error: ${(error as Error).message}` }],
    };
  }
  return validateAppSpec(parsed);
}
