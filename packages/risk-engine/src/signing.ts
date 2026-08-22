import { type KeyObject, generateKeyPairSync, sign, verify } from "node:crypto";
import type { RiskResult, SignedRiskResult } from "./types.js";

export interface SigningKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

/** Canonical JSON (recursive key-sort) of the result's own fields — same technique as `@aiappfactory/app-spec`'s `hashAppSpec`, so re-serializing the same result always signs/verifies identically regardless of key order. */
function canonicalize(result: RiskResult): Buffer {
  return Buffer.from(JSON.stringify(sortKeysDeep(result)));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function signRiskResult(result: RiskResult, privateKey: KeyObject): SignedRiskResult {
  const signature = sign(null, canonicalize(result), privateKey).toString("hex");
  return { ...result, signature };
}

/**
 * `publicKey` must come from the verifier's OWN trusted configuration —
 * never from the same payload being verified, and never from the caller of
 * this function passing along whatever the producer claimed. A signature
 * that verifies against a key the producer also supplied proves nothing.
 */
export function verifyRiskResult(signed: SignedRiskResult, publicKey: KeyObject): boolean {
  const { signature, ...result } = signed;
  try {
    return verify(null, canonicalize(result as RiskResult), publicKey, Buffer.from(signature, "hex"));
  } catch {
    return false; // malformed signature hex, wrong key type, etc. — fail closed, not throw
  }
}
