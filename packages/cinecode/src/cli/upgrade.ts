import { Command } from "commander";
import { spawn } from "node:child_process";
import { get } from "node:https";

export interface UpgradeInfo {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly hasUpgrade: boolean;
  readonly changelogUrl?: string;
  readonly breakingChanges?: string[];
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const request = get("https://registry.npmjs.org/cinecode/latest", { timeout: 6000 }, (response) => {
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
    changelogUrl: hasUpgrade ? "https://github.com/cinecode/cinecode/releases" : undefined,
    breakingChanges: hasUpgrade && latestVersion.split(".")[0] !== currentVersion.split(".")[0]
      ? ["Major version bump — review the migration guide before upgrading."]
      : undefined,
  };
}

function detectInstallCommand(): readonly [string, readonly string[]] {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.includes("pnpm")) return ["pnpm", ["i", "-g", "cinecode"]];
  if (agent.includes("yarn")) return ["yarn", ["global", "add", "cinecode"]];
  return ["npm", ["i", "-g", "cinecode"]];
}

export function createUpgradeCommand(): Command {
  return new Command("upgrade")
    .description("Check npm for a newer cinecode release")
    .option("--auto", "Run the detected global install command when an upgrade exists")
    .action(async (options: { auto?: boolean }) => {
      const info = await checkForUpgrade();
      console.log(`Current version: ${info.currentVersion}`);
      console.log(`Latest version:  ${info.latestVersion}`);
      if (!info.hasUpgrade) {
        console.log("You are up to date.");
        return;
      }
      const [command, args] = detectInstallCommand();
      console.log(`Upgrade available: ${command} ${args.join(" ")}`);
      if (info.changelogUrl) console.log(`Changelog: ${info.changelogUrl}`);
      for (const change of info.breakingChanges ?? []) console.log(`⚠ ${change}`);
      if (!options.auto) return;
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn(command, [...args], { stdio: "inherit", windowsHide: false });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`Upgrade failed with code ${code}`))));
      });
    });
}
