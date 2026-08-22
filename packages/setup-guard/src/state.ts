import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface PersistedState {
  /** scrypt(token, salt) — the raw token is never persisted, only ever handed to the operator once at generation time. */
  tokenHash: string;
  salt: string;
  completed: boolean;
}

/**
 * File-based persistence so the one-time token and the "setup already
 * completed" flag both survive a process restart before an operator gets to
 * them — an in-memory-only guard would silently reset (and re-expose an open
 * setup endpoint) on every deploy/crash-loop. This is a placeholder for a
 * Control Plane DB row (`packages/db`, not built yet — ROADMAP.md); the
 * on-disk format is intentionally the minimum needed to not be that DB.
 */
export class SetupGuardState {
  private constructor(
    private readonly filePath: string,
    private state: PersistedState
  ) {}

  static load(filePath: string): SetupGuardState {
    if (existsSync(filePath)) {
      const state = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedState;
      return new SetupGuardState(filePath, state);
    }
    return new SetupGuardState(filePath, { tokenHash: "", salt: "", completed: false });
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  isCompleted(): boolean {
    return this.state.completed;
  }

  hasToken(): boolean {
    return this.state.tokenHash.length > 0;
  }

  /** Generates a new one-time token, persists only its hash, and returns the raw token — the ONLY time it is ever available. */
  generateToken(): string {
    const token = randomBytes(32).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const tokenHash = scryptSync(token, salt, 64).toString("hex");
    this.state = { tokenHash, salt, completed: false };
    this.persist();
    return token;
  }

  verifyToken(candidate: string): boolean {
    if (this.state.completed || !this.state.tokenHash) return false;
    const candidateHash = scryptSync(candidate, this.state.salt, 64);
    const expected = Buffer.from(this.state.tokenHash, "hex");
    if (candidateHash.length !== expected.length) return false;
    return timingSafeEqual(candidateHash, expected);
  }

  /** One-way: once completed, `verifyToken` always returns false, regardless of the token — there is no way to re-open setup short of deleting the state file by hand. */
  markCompleted(): void {
    this.state = { ...this.state, completed: true };
    this.persist();
  }
}
