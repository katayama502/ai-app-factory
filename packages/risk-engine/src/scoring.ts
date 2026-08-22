import type { Finding, RiskResult, Severity, Verdict } from "./types.js";

export class RiskEngineError extends Error {}

const SEVERITY_POINTS: Record<Severity, number> = { LOW: 1, MEDIUM: 5, HIGH: 15, CRITICAL: 100 };
const SEVERITY_RANK: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Any single CRITICAL, or a cumulative score at/above this, is a hard RED. */
const RED_SCORE_THRESHOLD = 100;
/** A cumulative score at/above this (but below RED) is YELLOW — publishable only with approval. */
const YELLOW_SCORE_THRESHOLD = 10;
/** ADR-008: AI Review may add findings, but never past MEDIUM — enforced here, not just by convention at the call site. */
const AI_REVIEW_MAX_SEVERITY: Severity = "MEDIUM";

/**
 * Deterministic scoring (ADR-008 — "AI は加点のみ"): the same `findings` array
 * always produces the same `RiskResult`. Nothing here is probabilistic, and
 * nothing here can be talked out of a RED by an AI Review finding, structurally —
 * nothing in this function branches on `source === "ai-review"` in any way that
 * could *lower* a verdict, only the one guard that rejects a mis-tagged finding
 * outright before scoring even runs.
 */
export function evaluate(findings: Finding[]): RiskResult {
  for (const finding of findings) {
    if (finding.source === "ai-review" && rank(finding.severity) > rank(AI_REVIEW_MAX_SEVERITY)) {
      throw new RiskEngineError(
        `an "ai-review" finding may not exceed ${AI_REVIEW_MAX_SEVERITY} severity (ADR-008): got ${finding.severity} — "${finding.message}"`
      );
    }
  }

  const score = findings.reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0);
  const hasCritical = findings.some((f) => f.severity === "CRITICAL");
  const requiresApproval = findings.some((f) => f.requiresApproval);

  let verdict: Verdict;
  if (hasCritical || score >= RED_SCORE_THRESHOLD) {
    verdict = "RED";
  } else if (requiresApproval || score >= YELLOW_SCORE_THRESHOLD) {
    verdict = "YELLOW";
  } else {
    verdict = "GREEN";
  }

  return { verdict, score, findings, evaluatedAt: Date.now() };
}

function rank(severity: Severity): number {
  return SEVERITY_RANK.indexOf(severity);
}
