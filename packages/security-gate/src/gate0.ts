import { type AppSpec, validateAppSpec } from "@aiappfactory/app-spec";
import type { Finding } from "@aiappfactory/risk-engine";

export interface Gate0Result {
  findings: Finding[];
  spec?: AppSpec;
}

/**
 * Gate 0 (02_SECURITY §4.2), in library form: everything `validateAppSpec`
 * already checks (schema conformance, referential integrity, no internal-IP
 * egress, reserved words, actor fields, ...) *is* Gate 0 for T1/T2 — the
 * Constrained App Model (ADR-001) means most of what a traditional "Gate 0"
 * would need to check is already structurally enforced by the grammar the
 * Spec was validated against. A failure here is a hard block: an invalid
 * Spec can't be compiled or deployed at all, so every issue is CRITICAL and
 * no other gate runs against it (see `evaluateSpec.ts`).
 */
export function runGate0(input: unknown): Gate0Result {
  const result = validateAppSpec(input);
  if (!result.ok) {
    return {
      findings: result.issues.map((issue) => ({
        gate: "gate0-spec-validation",
        severity: "CRITICAL" as const,
        message: issue.message,
        path: issue.path,
        source: "deterministic" as const,
      })),
    };
  }
  return { findings: [], spec: result.spec };
}
