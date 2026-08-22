import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeRoot = join(import.meta.dirname, "..");
const companySdkRoot = join(import.meta.dirname, "..", "..", "..", "packages", "company-sdk");

const PG_IMPORT_PATTERN = /from ["']pg["']|require\(["']pg["']\)/;

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(fullPath);
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

/**
 * S-16 (02_SECURITY §12 "DB 資格情報の非配布"): the browser-facing process must never
 * hold DB credentials — only `sdk-gateway` does (01_ARCHITECTURE §5.1). This is
 * already true by construction (apps/runtime and company-sdk only ever talk HTTP to
 * sdk-gateway), but that's an invariant worth guarding structurally: if a future
 * change accidentally adds a direct Postgres connection to either package, this
 * fails immediately instead of silently reintroducing the exact credential-sprawl
 * risk the SDK Gateway pattern exists to prevent.
 */
describe("S-16: the app-facing process never holds DB credentials", () => {
  it("apps/runtime's package.json does not depend on \"pg\" in production (only as a devDependency, for its own integration test suite)", () => {
    const pkg = JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.pg).toBeUndefined();
  });

  it("company-sdk's package.json has no \"pg\" dependency at all — it only ever talks HTTP to sdk-gateway", () => {
    const pkg = JSON.parse(readFileSync(join(companySdkRoot, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.pg).toBeUndefined();
    expect(pkg.devDependencies?.pg).toBeUndefined();
  });

  it("no apps/runtime source file (src/, not its test suite) imports \"pg\"", () => {
    const offenders = collectTsFiles(join(runtimeRoot, "src")).filter((file) => PG_IMPORT_PATTERN.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("no company-sdk source file (src/, not its test suite) imports \"pg\"", () => {
    const offenders = collectTsFiles(join(companySdkRoot, "src")).filter((file) => PG_IMPORT_PATTERN.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
