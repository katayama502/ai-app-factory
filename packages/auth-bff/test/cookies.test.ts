import { describe, expect, it } from "vitest";
import { buildExpiredCookie, buildSessionCookie, parseCookieHeader, sessionCookieName } from "../src/cookies.js";

describe("sessionCookieName", () => {
  it("uses the __Host- prefix only when the connection is secure", () => {
    expect(sessionCookieName(true)).toBe("__Host-aiaf_session");
    expect(sessionCookieName(false)).toBe("aiaf_session");
  });
});

describe("buildSessionCookie", () => {
  it("always sets HttpOnly, SameSite=Lax, Path=/, and a Max-Age", () => {
    const cookie = buildSessionCookie("aiaf_session", "abc123", false, 3600);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when the connection is secure", () => {
    expect(buildSessionCookie("__Host-aiaf_session", "abc123", true, 3600)).toContain("Secure");
  });

  it("URL-encodes the value", () => {
    const cookie = buildSessionCookie("aiaf_session", "a b/c", false, 60);
    expect(cookie).toContain("aiaf_session=a%20b%2Fc");
  });
});

describe("buildExpiredCookie", () => {
  it("sets Max-Age=0 to clear the cookie", () => {
    expect(buildExpiredCookie("aiaf_session", false)).toContain("Max-Age=0");
  });
});

describe("parseCookieHeader", () => {
  it("parses multiple cookies", () => {
    expect(parseCookieHeader("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for an undefined header", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it("decodes URL-encoded values", () => {
    expect(parseCookieHeader("aiaf_session=a%20b")).toEqual({ aiaf_session: "a b" });
  });
});
