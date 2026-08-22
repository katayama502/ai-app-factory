import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSetupRoutes } from "../src/routes.js";
import { SetupGuardState } from "../src/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "setup-guard-routes-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildApp(guard: SetupGuardState, createAdmin = vi.fn().mockResolvedValue(undefined)) {
  const app = Fastify({ logger: false });
  buildSetupRoutes(app, { guard, createAdmin });
  return { app, createAdmin };
}

describe("setup routes — loopback restriction", () => {
  it("rejects a request whose remote address is not loopback, even with a valid token", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const { app } = buildApp(guard);

    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "203.0.113.5",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows a loopback request", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const { app } = buildApp(guard);

    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("setup routes — token + completion", () => {
  it("rejects a missing/wrong token", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    guard.generateToken();
    const { app } = buildApp(guard);

    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token: "wrong", username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("on success, calls createAdmin and marks setup completed", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const { app, createAdmin } = buildApp(guard);

    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(createAdmin).toHaveBeenCalledWith({ username: "admin", password: "pw", email: "a@example.com" });
    expect(guard.isCompleted()).toBe(true);
  });

  it("a second attempt after completion is refused, even with the original valid token", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const { app } = buildApp(guard);

    await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });

    const second = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "attacker", password: "pw2", email: "b@example.com" },
    });
    expect(second.statusCode).toBe(403);
  });

  it("leaves setup open for a retry if createAdmin throws, instead of locking the operator out", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const failingCreateAdmin = vi.fn().mockRejectedValueOnce(new Error("keycloak unreachable")).mockResolvedValueOnce(undefined);
    const { app } = buildApp(guard, failingCreateAdmin);

    const first = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(first.statusCode).toBe(500);
    expect(guard.isCompleted()).toBe(false);

    const retry = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token, username: "admin", password: "pw", email: "a@example.com" },
    });
    expect(retry.statusCode).toBe(200);
  });

  it("rejects missing required fields with 400", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    const token = guard.generateToken();
    const { app } = buildApp(guard);

    const res = await app.inject({
      method: "POST",
      url: "/setup",
      remoteAddress: "127.0.0.1",
      payload: { token },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /setup/status reports hasToken/completed without requiring a token", async () => {
    const guard = SetupGuardState.load(join(dir, "state.json"));
    guard.generateToken();
    const { app } = buildApp(guard);

    const res = await app.inject({ method: "GET", url: "/setup/status", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hasToken: true, completed: false });
  });
});
