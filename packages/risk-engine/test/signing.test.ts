import { describe, expect, it } from "vitest";
import { evaluate } from "../src/scoring.js";
import { generateSigningKeyPair, signRiskResult, verifyRiskResult } from "../src/signing.js";

describe("signRiskResult / verifyRiskResult", () => {
  it("a signature verifies against the correct public key", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const result = evaluate([]);
    const signed = signRiskResult(result, privateKey);
    expect(verifyRiskResult(signed, publicKey)).toBe(true);
  });

  it("fails against a DIFFERENT keypair's public key — a re-signed forgery with its own embedded key would not pass a real check", () => {
    const { privateKey } = generateSigningKeyPair();
    const attacker = generateSigningKeyPair();
    const result = evaluate([]);
    const signed = signRiskResult(result, privateKey);
    expect(verifyRiskResult(signed, attacker.publicKey)).toBe(false);
  });

  it("fails if any field of the result is tampered with after signing", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const result = evaluate([{ gate: "g", severity: "CRITICAL", message: "m" }]);
    const signed = signRiskResult(result, privateKey);
    const tampered = { ...signed, verdict: "GREEN" as const }; // attacker downgrades RED -> GREEN
    expect(verifyRiskResult(tampered, publicKey)).toBe(false);
  });

  it("fails gracefully (returns false, does not throw) on a malformed signature", () => {
    const { publicKey } = generateSigningKeyPair();
    const result = evaluate([]);
    const bogus = { ...result, signature: "not-hex-!!" };
    expect(verifyRiskResult(bogus, publicKey)).toBe(false);
  });

  it("is insensitive to key order in the signed object (canonical serialization)", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const result = evaluate([{ gate: "g", severity: "LOW", message: "m" }]);
    const signed = signRiskResult(result, privateKey);
    const reordered = {
      findings: signed.findings,
      evaluatedAt: signed.evaluatedAt,
      verdict: signed.verdict,
      score: signed.score,
      signature: signed.signature,
    };
    expect(verifyRiskResult(reordered, publicKey)).toBe(true);
  });
});
