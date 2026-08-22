import type { Finding, Severity } from "@aiappfactory/risk-engine";

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: Severity;
}

/**
 * Deliberately narrow, high-precision patterns over broad/noisy ones (a
 * generic "looks like base64" or "high entropy string" rule would flag
 * hashes, IDs, and legitimate config constantly — false positives are
 * "非エンジニア向けプロダクトでは致命傷", 04_IMPLEMENTATION §5). Each pattern here
 * is a real credential FORMAT with a recognizable prefix/shape, not a
 * heuristic. No external binary (gitleaks) — a real gitleaks integration is
 * still on ROADMAP.md; this is the in-process subset cheap enough to ship now.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key ID", regex: /AKIA[0-9A-Z]{16}/g, severity: "HIGH" },
  { name: "private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g, severity: "CRITICAL" },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g, severity: "HIGH" },
  { name: "Slack token", regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/g, severity: "HIGH" },
  { name: "generic secret-key-shaped token (sk-...)", regex: /\bsk-[A-Za-z0-9]{20,}\b/g, severity: "HIGH" },
];

function redact(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** Gate 2 (02_SECURITY §4.2): scans the Spec's raw source text — before parsing — for accidentally-pasted credentials, e.g. in a field's `default` value or `label`. */
export function runGate2(sourceText: string): Finding[] {
  const findings: Finding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const matches = sourceText.match(pattern.regex);
    if (!matches) continue;
    for (const match of new Set(matches)) {
      findings.push({
        gate: "gate2-secrets",
        severity: pattern.severity,
        message: `possible ${pattern.name} found in the Spec source (${redact(match)})`,
        source: "deterministic",
      });
    }
  }
  return findings;
}
