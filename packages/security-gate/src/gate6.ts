import type { AppSpec } from "@aiappfactory/app-spec";
import type { Finding } from "@aiappfactory/risk-engine";

/** EN + JA keyword dictionary (02_SECURITY §4.2 "PII辞書 日英") — a starting set, not exhaustive; extending it is cheap and low-risk (adding a pattern can only ever ADD findings, never silently approve something). */
const PII_FIELD_NAME_PATTERNS: RegExp[] = [
  /e-?mail/i,
  /phone|tel(ephone)?/i,
  /\bssn\b/i,
  /social.?security/i,
  /address/i,
  /salary|wage|income/i,
  /birth.?date|\bdob\b/i,
  /passport/i,
  /license.?number/i,
  /credit.?card/i,
  /bank.?account/i,
  /メール/,
  /電話/,
  /住所/,
  /給与|年収/,
  /生年月日/,
  /マイナンバー/,
  /口座/,
];

const SUFFICIENT_CLASSIFICATIONS = new Set(["PERSONAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL"]);

/**
 * Gate 6 heuristic (02_SECURITY §4.2 "データ分類推定"): flags a field whose
 * name/label looks like PII on an entity classified PUBLIC or INTERNAL. This
 * is advisory, not a hard block — `requiresApproval: true` forces a human
 * look (at least YELLOW) rather than silently rejecting the Spec, since a
 * name match is a heuristic that can be wrong in either direction.
 */
export function runGate6(spec: AppSpec): Finding[] {
  const findings: Finding[] = [];
  for (const entity of spec.data.entities) {
    if (SUFFICIENT_CLASSIFICATIONS.has(entity.classification)) continue;
    for (const field of entity.fields) {
      const looksLikePii = PII_FIELD_NAME_PATTERNS.some((pattern) => pattern.test(field.name) || pattern.test(field.label));
      if (!looksLikePii) continue;
      findings.push({
        gate: "gate6-data-classification",
        severity: "MEDIUM",
        message: `entity "${entity.name}" has a field ("${field.name}") that looks like personal data, but classification is "${entity.classification}" — consider PERSONAL, CONFIDENTIAL, or HIGHLY_CONFIDENTIAL`,
        path: `data.entities[${entity.name}].fields[${field.name}]`,
        source: "deterministic",
        requiresApproval: true,
      });
    }
  }
  return findings;
}
