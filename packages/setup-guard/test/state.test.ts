import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SetupGuardState } from "../src/state.js";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "setup-guard-test-"));
  filePath = join(dir, "setup-state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SetupGuardState", () => {
  it("starts with no token and not completed", () => {
    const state = SetupGuardState.load(filePath);
    expect(state.hasToken()).toBe(false);
    expect(state.isCompleted()).toBe(false);
  });

  it("generateToken returns a token that verifyToken accepts", () => {
    const state = SetupGuardState.load(filePath);
    const token = state.generateToken();
    expect(state.hasToken()).toBe(true);
    expect(state.verifyToken(token)).toBe(true);
  });

  it("rejects a wrong token", () => {
    const state = SetupGuardState.load(filePath);
    state.generateToken();
    expect(state.verifyToken("not-the-token")).toBe(false);
  });

  it("never persists the raw token — only a hash is on disk", () => {
    const state = SetupGuardState.load(filePath);
    const token = state.generateToken();
    const onDisk = readFileSync(filePath, "utf-8");
    expect(onDisk).not.toContain(token);
  });

  it("markCompleted makes every subsequent verifyToken call fail, even with the correct token", () => {
    const state = SetupGuardState.load(filePath);
    const token = state.generateToken();
    expect(state.verifyToken(token)).toBe(true);
    state.markCompleted();
    expect(state.verifyToken(token)).toBe(false);
    expect(state.isCompleted()).toBe(true);
  });

  it("survives a reload from disk (state persists across process restarts)", () => {
    const first = SetupGuardState.load(filePath);
    const token = first.generateToken();

    const reloaded = SetupGuardState.load(filePath);
    expect(reloaded.hasToken()).toBe(true);
    expect(reloaded.verifyToken(token)).toBe(true);

    reloaded.markCompleted();
    const reloadedAgain = SetupGuardState.load(filePath);
    expect(reloadedAgain.isCompleted()).toBe(true);
  });
});
