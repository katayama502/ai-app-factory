/**
 * SBOM generator (M10, lightweight slice — 04_IMPLEMENTATION §10 "SBOM/署名"). Produces
 * a CycloneDX 1.5 JSON document covering every workspace package (as first-party
 * "application" components) and every resolved third-party npm dependency, direct and
 * transitive (as "library" components, deduplicated by name@version, with each one's
 * REAL license read from its own installed package.json — not guessed). Run with
 * `pnpm sbom` (writes `sbom.cdx.json` at the repo root) or `pnpm sbom -- --stdout` to
 * print instead of writing a file.
 *
 * Source of truth: `pnpm list -r --json --depth=Infinity`, not a hand-parse of
 * pnpm-lock.yaml — pnpm has already done the version resolution; re-deriving it from
 * the lockfile format would just be a second, easier-to-drift copy of what `pnpm list`
 * already reports authoritatively.
 *
 * NOT built: signing (§10's other half). There is no release artifact to sign yet —
 * no container image, no tagged version — so a signature would have nothing meaningful
 * to attach to. See ROADMAP.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

interface PnpmDepNode {
  from?: string;
  version: string;
  resolved?: string;
  path?: string;
  dependencies?: Record<string, PnpmDepNode>;
  devDependencies?: Record<string, PnpmDepNode>;
  optionalDependencies?: Record<string, PnpmDepNode>;
}

interface PnpmProject {
  name: string;
  version: string;
  path: string;
  private?: boolean;
  dependencies?: Record<string, PnpmDepNode>;
  devDependencies?: Record<string, PnpmDepNode>;
  optionalDependencies?: Record<string, PnpmDepNode>;
}

interface Component {
  type: "application" | "library";
  name: string;
  version: string;
  purl: string;
  license?: string;
}

function purlFor(name: string, version: string): string {
  const encodedName = name.startsWith("@") ? `%40${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${version}`;
}

function licenseOf(packagePath: string | undefined): string | undefined {
  if (!packagePath) return undefined;
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { license?: string | { type?: string } };
    if (typeof manifest.license === "string") return manifest.license;
    if (manifest.license && typeof manifest.license === "object") return manifest.license.type;
    return undefined;
  } catch {
    return undefined;
  }
}

function collectThirdPartyComponents(node: Record<string, PnpmDepNode> | undefined, seen: Map<string, Component>): void {
  if (!node) return;
  for (const [name, dep] of Object.entries(node)) {
    if (!dep.version.startsWith("link:")) {
      const key = `${name}@${dep.version}`;
      if (!seen.has(key)) {
        const license = licenseOf(dep.path);
        seen.set(key, { type: "library", name, version: dep.version, purl: purlFor(name, dep.version), ...(license ? { license } : {}) });
      }
    }
    // Recurse regardless of link:/real — a workspace package's OWN deps still need walking.
    collectThirdPartyComponents(dep.dependencies, seen);
    collectThirdPartyComponents(dep.devDependencies, seen);
    collectThirdPartyComponents(dep.optionalDependencies, seen);
  }
}

function main(): void {
  const stdout = process.argv.includes("--stdout");

  const raw = execFileSync("pnpm", ["list", "-r", "--json", "--depth=Infinity"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const projects = JSON.parse(raw) as PnpmProject[];

  const firstParty: Component[] = projects
    .filter((project) => project.name !== "ai-app-factory")
    .map((project) => ({ type: "application", name: project.name, version: project.version, purl: purlFor(project.name, project.version) }));

  const thirdPartySeen = new Map<string, Component>();
  for (const project of projects) {
    collectThirdPartyComponents(project.dependencies, thirdPartySeen);
    collectThirdPartyComponents(project.devDependencies, thirdPartySeen);
    collectThirdPartyComponents(project.optionalDependencies, thirdPartySeen);
  }
  const thirdParty = [...thirdPartySeen.values()].sort((a, b) => a.name.localeCompare(b.name));

  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { name: string; version: string };

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { type: "application", name: rootPkg.name, version: rootPkg.version },
    },
    components: [...firstParty, ...thirdParty],
  };

  const json = JSON.stringify(sbom, null, 2);
  if (stdout) {
    console.log(json);
  } else {
    const outPath = join(repoRoot, "sbom.cdx.json");
    writeFileSync(outPath, json + "\n");
    console.log(`wrote ${outPath} (${firstParty.length} workspace packages, ${thirdParty.length} unique third-party dependencies)`);
  }
}

main();
