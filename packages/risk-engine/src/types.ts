export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Verdict = "GREEN" | "YELLOW" | "RED";

export interface Finding {
  /** Which gate produced this, e.g. "gate0-spec-validation", "gate2-secrets". */
  gate: string;
  severity: Severity;
  message: string;
  /** Where in the Spec this applies, e.g. "data.entities[2].fields[0]". */
  path?: string;
  /**
   * `"ai-review"` findings are capped at MEDIUM severity and can never by
   * themselves push a verdict to RED (ADR-008: AI can only raise risk within
   * a bound, never clear it, never singlehandedly block/approve). Omit for
   * deterministic (rule-based) findings, which have no such cap.
   */
  source?: "deterministic" | "ai-review";
  /** Forces at least YELLOW regardless of point score — for findings that are individually minor but always warrant a human look. */
  requiresApproval?: boolean;
}

export interface RiskResult {
  verdict: Verdict;
  score: number;
  findings: Finding[];
  specHash?: string;
  evaluatedAt: number;
}

/**
 * `signature` covers every OTHER field of this object (see `signing.ts`).
 * Deliberately does NOT carry the public key used to verify it — that must
 * come from the verifier's own trusted configuration, never from the payload
 * being verified. A signature that verifies against a key bundled in its own
 * payload proves nothing: anyone can re-sign with their own keypair and
 * bundle their own public key.
 */
export interface SignedRiskResult extends RiskResult {
  signature: string;
}
