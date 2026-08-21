import { describe, expect, it } from "vitest";
import { DevUserDirectory } from "../src/devUsers.js";

describe("DevUserDirectory", () => {
  it("authenticates a known user with the correct password", () => {
    const dir = new DevUserDirectory();
    const ctx = { userId: "u1", department: "d1", roles: ["member"] };
    dir.add("alice", { password: "secret", ctx });
    expect(dir.authenticate("alice", "secret")).toBe(ctx);
  });

  it("rejects a wrong password", () => {
    const dir = new DevUserDirectory();
    dir.add("alice", { password: "secret", ctx: { userId: "u1", department: "d1", roles: [] } });
    expect(dir.authenticate("alice", "wrong")).toBeNull();
  });

  it("rejects an unknown user", () => {
    const dir = new DevUserDirectory();
    expect(dir.authenticate("ghost", "anything")).toBeNull();
  });
});
