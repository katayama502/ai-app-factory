import { hashAppSpec } from "@aiappfactory/app-spec";
import { type Finding, type RiskResult, evaluate } from "@aiappfactory/risk-engine";
import { runGate0 } from "./gate0.js";
import { runGate2 } from "./gate2.js";
import { runGate6 } from "./gate6.js";

export interface SecurityGateOptions {
  /** Raw Spec source text (the YAML the Spec was authored/generated as) for Gate 2's secret scan. Falls back to `JSON.stringify(input)` if omitted — still catches secrets in field values, just without YAML comments/formatting in the scanned text. */
  sourceText?: string;
  /**
   * Findings from an external AI Review pass (Gate 7, not built here — this
   * is the integration point for it). Passed straight into `risk-engine`,
   * which enforces the MEDIUM cap and rejects anything mistagged — this
   * package doesn't re-implement that check, it just doesn't strip the
   * `source: "ai-review"` tag that makes the cap apply.
   */
  aiReviewFindings?: Finding[];
}

/**
 * Runs the gate set this package implements and produces a `risk-engine`
 * verdict. A Gate 0 failure is a hard stop — an invalid Spec can't be
 * compiled or deployed, so nothing else runs against it and every issue is
 * CRITICAL (see gate0.ts). A valid Spec proceeds through Gate 2 (secrets) and
 * Gate 6 (PII-under-classification heuristic); Gates 1/3/4/5/7/8/9
 * (OPA policy, Trivy/Opengrep, AI Review, dynamic egress observation,
 * acceptance-test generation) are 02_SECURITY's fuller pipeline and are not
 * built here — see ROADMAP.md.
 */
export function runSecurityGate(input: unknown, options: SecurityGateOptions = {}): RiskResult {
  const gate0 = runGate0(input);
  if (!gate0.spec) {
    return evaluate(gate0.findings);
  }

  const sourceText = options.sourceText ?? JSON.stringify(input);

  let findings: Finding[];
  try {
    findings = [...gate0.findings, ...runGate2(sourceText), ...runGate6(gate0.spec), ...(options.aiReviewFindings ?? [])];
  } catch (error) {
    // S-08 (02_SECURITY §12, fail-closed: "スキャナを意図的に落として publish → RED"). A
    // gate that throws must never be silently treated as "found nothing" — this
    // forces RED exactly like an explicit CRITICAL finding would, with the
    // underlying error preserved so an operator can tell "no issues" from
    // "couldn't check."
    const crashFinding: Finding = {
      gate: "gate-crash",
      severity: "CRITICAL",
      message: `a security gate crashed before completing: ${error instanceof Error ? error.message : String(error)}`,
      source: "deterministic",
    };
    return { ...evaluate([...gate0.findings, crashFinding]), specHash: hashAppSpec(gate0.spec) };
  }

  const result = evaluate(findings);
  return { ...result, specHash: hashAppSpec(gate0.spec) };
}
