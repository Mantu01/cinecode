import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CinecodeGlobalConfig {
  aliases?: Record<string, string>;
  defaultProfile?: string;
}

export function getGlobalConfigPath(): string {
  const home = os.homedir();
  return path.join(home, ".cinecode", "config.json");
}

export function loadGlobalConfig(): CinecodeGlobalConfig {
  const cfgPath = getGlobalConfigPath();
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: CinecodeGlobalConfig): void {
  const cfgPath = getGlobalConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf8");
}

export function loadAliases(projectDir = process.cwd()): Record<string, string> {
  const globalCfg = loadGlobalConfig();
  const result: Record<string, string> = { ...(globalCfg.aliases || {}) };

  const localPkg = path.join(projectDir, "package.json");
  if (fs.existsSync(localPkg)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(localPkg, "utf8"));
      if (pkg.cinecode?.aliases) {
        Object.assign(result, pkg.cinecode.aliases);
      }
    } catch {}
  }

  const localCinecodeJson = path.join(projectDir, "cinecode.json");
  if (fs.existsSync(localCinecodeJson)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localCinecodeJson, "utf8"));
      if (cfg.aliases) {
        Object.assign(result, cfg.aliases);
      }
    } catch {}
  }

  return result;
}

export function setAlias(name: string, expansion: string): void {
  const globalCfg = loadGlobalConfig();
  if (!globalCfg.aliases) globalCfg.aliases = {};
  globalCfg.aliases[name] = expansion;
  saveGlobalConfig(globalCfg);
}

export function removeAlias(name: string): boolean {
  const globalCfg = loadGlobalConfig();
  if (globalCfg.aliases && name in globalCfg.aliases) {
    delete globalCfg.aliases[name];
    saveGlobalConfig(globalCfg);
    return true;
  }
  return false;
}

export function expandCliArgs(args: string[], projectDir = process.cwd(), depth = 0): string[] {
  if (args.length === 0 || depth > 5) return args;

  const first = args[0];
  if (!first || first.startsWith("-")) return args;

  const aliases = loadAliases(projectDir);
  const expansion = aliases[first];
  if (!expansion) return args;

  const expandedParts = expansion.split(/\s+/).filter(Boolean);
  const remaining = args.slice(1);
  return expandCliArgs([...expandedParts, ...remaining], projectDir, depth + 1);
}
