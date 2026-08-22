/**
 * Installation Doctor (M6, lightweight slice — 04_IMPLEMENTATION E6-2 "Installation
 * Doctor（CPU/RAM/Disk/Port/Runtime 判定、日本語の対処法）"). A one-shot pre-flight
 * check for whether this machine is ready to run AI App Factory locally — Node/pnpm/
 * Docker presence, RAM/disk headroom, and whether the ports the dev flows bind
 * (Postgres/Valkey/Keycloak/sdk-gateway/runtime) are free — printing a Japanese
 * remediation hint for anything that fails, per 03_REPOSITORY's "エラーが出たら次に
 * すべきことを必ず出す" principle. Run with `pnpm doctor`.
 *
 * NOT a running health monitor (M6's separate, unbuilt "監視" item) — this only
 * checks readiness once, on demand, before you try to boot anything.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statfsSync } from "node:fs";
import { createServer } from "node:net";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { engines?: { node?: string } };

type Status = "ok" | "warn" | "fail";
interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const results: CheckResult[] = [];

function check(name: string, status: Status, detail: string, fix?: string): void {
  results.push({ name, status, detail, ...(fix ? { fix } : {}) });
}

function checkNode(): void {
  const required = pkg.engines?.node ?? ">=20.11.0";
  const requiredMajor = Number(required.replace(/[^\d.]/g, "").split(".")[0]);
  const currentMajor = Number(process.version.slice(1).split(".")[0]);
  if (currentMajor >= requiredMajor) {
    check("Node.js", "ok", `${process.version}（要件 ${required} を満たしています）`);
  } else {
    check(
      "Node.js",
      "fail",
      `${process.version} は要件 ${required} を満たしていません`,
      `Node.js を ${required} 以上にアップグレードしてください（nvm や Volta の利用を推奨）。`
    );
  }
}

function checkPnpm(): void {
  try {
    const version = execFileSync("pnpm", ["--version"]).toString().trim();
    check("pnpm", "ok", `pnpm ${version} が見つかりました`);
  } catch {
    check("pnpm", "fail", "pnpm コマンドが見つかりません", "https://pnpm.io/installation の手順に従ってインストールしてください。");
  }
}

function checkDocker(): void {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    check("Docker", "ok", "Docker デーモンが起動しています");
  } catch {
    check(
      "Docker",
      "warn",
      "Docker が見つからないか、デーモンが起動していません",
      "Keycloak を使うフロー（pnpm dev:sample の一部、統合テスト、docker compose）には Docker Desktop の起動が必要です。https://www.docker.com/products/docker-desktop/ からインストールし、起動してください。"
    );
  }
}

function checkMemory(): void {
  const totalGiB = totalmem() / 1024 ** 3;
  if (totalGiB >= 4) {
    check("メモリ", "ok", `合計 ${totalGiB.toFixed(1)}GB`);
  } else {
    check(
      "メモリ",
      "warn",
      `合計 ${totalGiB.toFixed(1)}GB（推奨 4GB 以上）`,
      "Postgres + Keycloak + Node プロセスを同時に動かすと動作が重くなる可能性があります。"
    );
  }
}

function checkDisk(): void {
  try {
    const stats = statfsSync(process.cwd());
    const availGiB = (stats.bavail * stats.bsize) / 1024 ** 3;
    if (availGiB >= 5) {
      check("ディスク空き容量", "ok", `${availGiB.toFixed(1)}GB 空き`);
    } else {
      check(
        "ディスク空き容量",
        "warn",
        `${availGiB.toFixed(1)}GB 空き（推奨 5GB 以上）`,
        "Postgres/Keycloak の Docker イメージと node_modules だけで数GBを消費します。空き容量を確保してください。"
      );
    }
  } catch (error) {
    check("ディスク空き容量", "warn", "確認できませんでした", String(error));
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

const DEV_PORTS: Array<[number, string]> = [
  [5432, "Postgres"],
  [6379, "Valkey"],
  [8180, "Keycloak"],
  [4100, "sdk-gateway"],
  [4200, "apps/runtime"],
];

async function checkPorts(): Promise<void> {
  for (const [port, label] of DEV_PORTS) {
    const free = await isPortFree(port);
    if (free) {
      check(`ポート ${port}（${label}）`, "ok", "空いています");
    } else {
      // Not a failure: pnpm dev:sample is designed to REUSE an existing local
      // Postgres/Keycloak on these ports rather than requiring them free.
      check(
        `ポート ${port}（${label}）`,
        "warn",
        "使用中です",
        `既に何かが ${port} を使用しています。lsof -i :${port} で確認してください。この repo の pnpm dev:sample は既存の Postgres/Keycloak をそのまま再利用するので、それらが理由であれば問題ありません。`
      );
    }
  }
}

async function main(): Promise<void> {
  checkNode();
  checkPnpm();
  checkDocker();
  checkMemory();
  checkDisk();
  await checkPorts();

  console.log("\nAI App Factory — Installation Doctor\n");
  let hasFail = false;
  for (const result of results) {
    const icon = result.status === "ok" ? "✓" : result.status === "warn" ? "△" : "✗";
    console.log(`${icon} ${result.name}: ${result.detail}`);
    if (result.fix) console.log(`  → ${result.fix}`);
    if (result.status === "fail") hasFail = true;
  }
  console.log("");

  if (hasFail) {
    console.log("必須要件を満たしていない項目があります。上記の対処法を確認してください。");
    process.exitCode = 1;
  } else {
    console.log("必須チェックはすべて合格しました。");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
