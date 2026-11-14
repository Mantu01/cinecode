import { execSync } from "node:child_process";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const npmExecPath = process.env.npm_execpath ?? "";

  if (userAgent.startsWith("pnpm/") || npmExecPath.includes("pnpm")) {
    return "pnpm";
  }
  if (userAgent.startsWith("yarn/") || npmExecPath.includes("yarn")) {
    return "yarn";
  }
  if (userAgent.startsWith("bun/") || npmExecPath.includes("bun")) {
    return "bun";
  }
  if (process.argv[0]?.includes("bun")) {
    return "bun";
  }

  return "npm";
}

export function getInstallCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "install"];
    case "yarn":
      return ["yarn", "install"];
    case "bun":
      return ["bun", "install"];
    case "npm":
    default:
      return ["npm", "install"];
  }
}

export function getRunCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
    case "npm":
    default:
      return `npm run ${script}`;
  }
}

export async function getPackageManagerVersion(pm: PackageManager): Promise<string> {
  try {
    const output = execSync(`${pm} --version`, { encoding: "utf-8", stdio: "pipe" });
    return output.trim();
  } catch {
    return "unknown";
  }
}

export function getInitCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "init", "-y"];
    case "yarn":
      return ["yarn", "init", "-y"];
    case "bun":
      return ["bun", "init", "-y"];
    case "npm":
    default:
      return ["npm", "init", "-y"];
  }
}