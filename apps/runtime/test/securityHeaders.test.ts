import { describe, expect, it, vi } from "vitest";
import { applySecurityHeaders } from "../src/securityHeaders.js";

describe("applySecurityHeaders", () => {
  it("sets the origin-isolation headers ADR-012 / T-02b require", () => {
    const header = vi.fn();
    applySecurityHeaders({ header } as never);

    expect(header).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(header).toHaveBeenCalledWith("Cross-Origin-Opener-Policy", "same-origin");
    expect(header).toHaveBeenCalledWith("Cross-Origin-Resource-Policy", "same-origin");
    expect(header).toHaveBeenCalledWith("Content-Security-Policy", expect.stringContaining("frame-ancestors 'none'"));
  });
});
