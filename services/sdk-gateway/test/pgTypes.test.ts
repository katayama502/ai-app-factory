import pg from "pg";
import { describe, expect, it } from "vitest";
import "../src/pgTypes.js";

describe("DATE type parser override", () => {
  it("returns the raw 'YYYY-MM-DD' string instead of a locale-shifted Date", () => {
    const parser = pg.types.getTypeParser(pg.types.builtins.DATE);
    expect(parser("2026-08-21")).toBe("2026-08-21");
  });
});
