import { Command } from "commander";
import { get } from "node:https";
import { createError, ErrorCode } from "../errors/index.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";

export interface UpgradeInfo {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly hasUpgrade: boolean;
  readonly changelogUrl?: string;
  readonly breakingChanges?: string[];
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const request = get("https://registry.npmjs.org/cinecode/latest", { timeout: 3000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk.toString(); });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { version?: string };
          resolvePromise(parsed.version ?? null);
        } catch {
          resolvePromise(null);
        }
      });
    });
    request.on("error", () => resolvePromise(null));
    request.on("timeout", () => {
      request.destroy();
      resolvePromise(null);
    });
  });
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function checkForUpgrade(currentVersion = process.env.CINECODE_VERSION ?? "1.0.0"): Promise<UpgradeInfo> {
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return { currentVersion, latestVersion: currentVersion, hasUpgrade: false };
  const hasUpgrade = compareVersions(latestVersion, currentVersion) > 0;
  return {
    currentVersion,
    latestVersion,
    hasUpgrade,
    changelogUrl: hasUpgrade ? "https://github.com/Mantu01/cinecode/releases" : undefined,
    breakingChanges: hasUpgrade && latestVersion.split(".")[0] !== currentVersion.split(".")[0]
      ? ["Major version bump — review the migration guide before upgrading."]
      : undefined,
  };
}

export async function upgradeCommand(options: { confirm?: boolean } = {}): Promise<void> {
  const targetUrl = "https://registry.npmjs.org/cinecode/latest";
  console.log(`Network target: ${targetUrl}`);
  if (!options.confirm) {
    throw createError(ErrorCode.CC7004, { reason: `Network opt-in missing: rerun \`cinecode upgrade --confirm\`. Target: ${targetUrl}` });
  }
  const info = await checkForUpgrade();
  console.log(`Current version: ${info.currentVersion}`);
  console.log(`Latest version:  ${info.latestVersion}`);
  if (!info.hasUpgrade) {
    console.log("You are up to date.");
    return;
  }
  console.log(`Upgrade available (v${info.latestVersion}). Run npm i -g cinecode to update.`);
  if (info.changelogUrl) console.log(`Changelog: ${info.changelogUrl}`);
  for (const change of info.breakingChanges ?? []) console.log(`⚠ ${change}`);
}

export function createUpgradeCommand(): Command {
  return buildCommanderCommand(findCommand("upgrade")!);
}
