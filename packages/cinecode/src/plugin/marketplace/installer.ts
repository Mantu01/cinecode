import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { marketplaceClient } from "./client.js";

export interface InstalledPluginInfo {
  name: string;
  version: string;
  active: boolean;
  permissions: string[];
  kind?: string;
  description?: string;
}

export function findPluginConfigFile(projectDir: string): string | undefined {
  const candidates = [
    "cinecode.config.ts",
    "cinecode.config.js",
    "cinecode.config.mjs",
    "cinecode.config.json",
  ];
  for (const name of candidates) {
    const full = path.join(projectDir, name);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

export function updateConfigPlugins(projectDir: string, pluginName: string, action: "add" | "remove"): void {
  let configFile = findPluginConfigFile(projectDir);
  if (!configFile) {
    configFile = path.join(projectDir, "cinecode.config.ts");
    fs.writeFileSync(
      configFile,
      `import { defineConfig } from "cinecode";\n\nexport default defineConfig({\n  plugins: [],\n});\n`,
      "utf8",
    );
  }

  const content = fs.readFileSync(configFile, "utf8");

  if (configFile.endsWith(".json")) {
    try {
      const json = JSON.parse(content);
      const plugins: string[] = json.plugins || [];
      if (action === "add" && !plugins.includes(pluginName)) {
        plugins.push(pluginName);
      } else if (action === "remove") {
        const idx = plugins.indexOf(pluginName);
        if (idx !== -1) plugins.splice(idx, 1);
      }
      json.plugins = plugins;
      fs.writeFileSync(configFile, JSON.stringify(json, null, 2), "utf8");
    } catch {}
    return;
  }

  if (action === "add") {
    if (content.includes(`"${pluginName}"`) || content.includes(`'${pluginName}'`)) {
      return;
    }
    const pluginsMatch = content.match(/plugins:\s*\[([\s\S]*?)\]/);
    if (pluginsMatch) {
      const inner = pluginsMatch[1]?.trim() || "";
      const separator = inner ? ", " : "";
      const updated = content.replace(
        /plugins:\s*\[([\s\S]*?)\]/,
        `plugins: [${inner}${separator}"${pluginName}"]`,
      );
      fs.writeFileSync(configFile, updated, "utf8");
    }
  } else if (action === "remove") {
    const regex = new RegExp(`["']${pluginName}["'],?\\s*`, "g");
    const updated = content.replace(regex, "");
    fs.writeFileSync(configFile, updated, "utf8");
  }
}

export async function installPlugin(
  packageName: string,
  options: { projectDir?: string; pm?: string } = {},
): Promise<{ success: boolean; packageName: string; message: string }> {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const pm = options.pm || "pnpm";

  try {
    execSync(`${pm} add ${packageName}`, { cwd: projectDir, stdio: "pipe" });
    updateConfigPlugins(projectDir, packageName, "add");
    return {
      success: true,
      packageName,
      message: `Successfully installed '${packageName}' and updated cinecode config.`,
    };
  } catch (err) {
    return {
      success: false,
      packageName,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removePlugin(
  packageName: string,
  options: { projectDir?: string; pm?: string } = {},
): Promise<{ success: boolean; packageName: string; message: string }> {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const pm = options.pm || "pnpm";

  try {
    execSync(`${pm} remove ${packageName}`, { cwd: projectDir, stdio: "pipe" });
    updateConfigPlugins(projectDir, packageName, "remove");
    return {
      success: true,
      packageName,
      message: `Successfully removed '${packageName}' and cleaned cinecode config.`,
    };
  } catch (err) {
    return {
      success: false,
      packageName,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listInstalledPlugins(projectDir = process.cwd()): Promise<InstalledPluginInfo[]> {
  const pkgJsonPath = path.join(projectDir, "package.json");
  const result: InstalledPluginInfo[] = [];
  if (!fs.existsSync(pkgJsonPath)) return result;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const configFile = findPluginConfigFile(projectDir);
    const configContent = configFile ? fs.readFileSync(configFile, "utf8") : "";

    for (const [depName, version] of Object.entries(deps)) {
      if (depName.startsWith("@cinecode/plugin-") || depName.includes("cinecode-plugin")) {
        const active = configContent.includes(depName);
        const meta = await marketplaceClient.fetchPluginInfo(depName);
        result.push({
          name: depName,
          version: String(version),
          active,
          permissions: meta?.permissions || ["frame:process"],
          kind: meta?.kind,
          description: meta?.description,
        });
      }
    }
  } catch {}

  return result;
}
