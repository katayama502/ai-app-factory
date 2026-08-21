import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessionStore.js";

const claims = { userId: "u1", department: "d1", roles: ["sales_member"] };

describe("SessionStore — sessions", () => {
  it("resolves a session created with createSession", () => {
    const store = new SessionStore();
    const sid = store.createSession(claims, 3600);
    expect(store.resolveSession(sid)).toEqual(claims);
  });

  it("returns undefined for an unknown session id", () => {
    const store = new SessionStore();
    expect(store.resolveSession("ghost")).toBeUndefined();
  });

  it("returns undefined for an expired session and evicts it", () => {
    const store = new SessionStore();
    const sid = store.createSession(claims, -1); // already expired
    expect(store.resolveSession(sid)).toBeUndefined();
    expect(store.resolveSession(sid)).toBeUndefined(); // still gone, not re-added
  });

  it("destroySession removes the session immediately", () => {
    const store = new SessionStore();
    const sid = store.createSession(claims, 3600);
    store.destroySession(sid);
    expect(store.resolveSession(sid)).toBeUndefined();
  });

  it("resolveSession(undefined) returns undefined without throwing", () => {
    expect(new SessionStore().resolveSession(undefined)).toBeUndefined();
  });
});

describe("SessionStore — pending logins (PKCE/state)", () => {
  it("consumePendingLogin returns what was stored", () => {
    const store = new SessionStore();
    store.createPendingLogin("verifier", "state1", "nonce1", "/pages/0");
    expect(store.consumePendingLogin("state1")).toMatchObject({
      codeVerifier: "verifier",
      state: "state1",
      nonce: "nonce1",
      returnTo: "/pages/0",
    });
  });

  it("is one-shot: consuming the same state twice fails the second time (replay protection)", () => {
    const store = new SessionStore();
    store.createPendingLogin("verifier", "state1", "nonce1", "/");
    expect(store.consumePendingLogin("state1")).toBeDefined();
    expect(store.consumePendingLogin("state1")).toBeUndefined();
  });

  it("returns undefined for an unknown state", () => {
    expect(new SessionStore().consumePendingLogin("ghost")).toBeUndefined();
  });
});
