import { Command } from "commander";
import { get } from "node:https";
import { CINECODE_VERSION } from "../../version.js";
import { runReport } from "../output/run-report.js";

export interface UpgradeInfo {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly hasUpgrade: boolean;
  readonly reachable: boolean;
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

export async function checkForUpgrade(currentVersion = CINECODE_VERSION): Promise<UpgradeInfo> {
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return { currentVersion, latestVersion: currentVersion, hasUpgrade: false, reachable: false };
  const hasUpgrade = compareVersions(latestVersion, currentVersion) > 0;
  return {
    currentVersion,
    latestVersion,
    hasUpgrade,
    reachable: true,
    changelogUrl: hasUpgrade ? "https://github.com/Mantu01/cinecode/releases" : undefined,
    breakingChanges: hasUpgrade && latestVersion.split(".")[0] !== currentVersion.split(".")[0]
      ? ["Major version bump — review the migration guide before upgrading."]
      : undefined,
  };
}

export async function upgradeCommand(options: { confirm?: boolean } = {}): Promise<void> {
  const targetUrl = "https://registry.npmjs.org/cinecode/latest";
  if (!options.confirm) {
    runReport.result({ currentVersion: CINECODE_VERSION, requiresConfirm: true, networkTarget: targetUrl });
    if (!runReport.isMachine()) {
      runReport.diagnostic(`Current version: ${CINECODE_VERSION}`);
      runReport.diagnostic(`Upgrade check plan: GET ${targetUrl}`);
      runReport.diagnostic("No network access performed. Rerun `cinecode upgrade --confirm` to check for a newer release.");
    }
    return;
  }
  const info = await checkForUpgrade();
  const upgradeCommand = "npm i -g cinecode";
  const checkFailed = !info.reachable;
  runReport.result({
    currentVersion: info.currentVersion,
    latestVersion: checkFailed ? undefined : info.latestVersion,
    hasUpgrade: info.hasUpgrade,
    upToDate: !info.hasUpgrade,
    checkFailed,
    upgradeCommand: info.hasUpgrade ? upgradeCommand : undefined,
    changelogUrl: info.changelogUrl,
    breakingChanges: info.breakingChanges,
    networkTarget: targetUrl,
  });
  if (!runReport.isMachine()) {
    runReport.diagnostic(`Current version: ${info.currentVersion}`);
    if (checkFailed) {
      runReport.diagnostic("Could not reach the npm registry; upgrade status unknown.");
      return;
    }
    runReport.diagnostic(`Latest version:  ${info.latestVersion}`);
    if (!info.hasUpgrade) {
      runReport.diagnostic("You are up to date.");
      return;
    }
    runReport.diagnostic(`Upgrade available (v${info.latestVersion}). Run ${upgradeCommand} to update.`);
    if (info.changelogUrl) runReport.diagnostic(`Changelog: ${info.changelogUrl}`);
    for (const change of info.breakingChanges ?? []) runReport.diagnostic(`⚠ ${change}`);
  }
}

