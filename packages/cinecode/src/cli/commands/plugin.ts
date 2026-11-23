import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { scaffoldPlugin, type TemplateType } from "../../plugin/scaffold/index.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";

const SUPPORTED_API_MAJOR = 1;

export interface InstalledPluginInfo {
  readonly name: string;
  readonly version: string;
  readonly source: "dependencies";
  readonly apiVersion: string;
  readonly compatible: boolean;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly permissions: readonly string[];
  readonly kind?: string;
  readonly description?: string;
}

export function listInstalledPlugins(projectDir = process.cwd()): InstalledPluginInfo[] {
  const pkgJsonPath = path.join(projectDir, "package.json");
  const result: InstalledPluginInfo[] = [];
  if (!fs.existsSync(pkgJsonPath)) return result;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [depName, version] of Object.entries(deps)) {
      if (!depName.startsWith("@cinecode/plugin-") && !depName.includes("cinecode-plugin")) continue;
      let permissions: string[] = ["frame:process"];
      let kind = "effect";
      let description = "";
      let apiVersion = "1.0.0";
      const depPkgPath = path.join(projectDir, "node_modules", depName, "package.json");
      if (fs.existsSync(depPkgPath)) {
        try {
          const depPkg = JSON.parse(fs.readFileSync(depPkgPath, "utf8"));
          if (depPkg.cinecode) {
            if (Array.isArray(depPkg.cinecode.permissions)) permissions = depPkg.cinecode.permissions;
            if (depPkg.cinecode.kind) kind = depPkg.cinecode.kind;
            if (depPkg.cinecode.description) description = depPkg.cinecode.description;
            if (typeof depPkg.cinecode.apiVersion === "string") apiVersion = depPkg.cinecode.apiVersion;
          }
        } catch {
          // Note: ignore corrupt plugin package.json
        }
      }
      const compatible = Number.parseInt(apiVersion.split(".")[0] ?? "", 10) === SUPPORTED_API_MAJOR;
      result.push({
        name: depName,
        version: String(version),
        source: "dependencies",
        apiVersion,
        compatible,
        enabled: compatible,
        active: compatible,
        permissions,
        kind,
        description,
      });
    }
  } catch {
    // Note: ignore missing project package.json
  }
  return result;
}

interface PluginOptions {
  type?: TemplateType;
  desc?: string;
  author?: string;
  root?: string;
  config?: string;
  force?: boolean;
}

function pluginBaseDir(options: PluginOptions, context?: import("../gate/preflight.js").PreflightContext): string {
  return context?.resolution?.root ?? (options.root ? path.resolve(options.root) : process.cwd());
}

export async function pluginCommand(
  action = "list",
  name?: string,
  options: PluginOptions = {},
  context?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  if (action !== "list" && action !== "init") {
    throw new UsageError(`Unknown plugin action '${action}'. Use 'list' or 'init'.`);
  }
  if (action === "list") {
    const plugins = listInstalledPlugins(pluginBaseDir(options, context));
    runReport.result({ action: "list", plugins });
    if (plugins.length === 0) {
      if (!runReport.isMachine()) runReport.diagnostic("No Cinecode plugins installed in project.");
      return;
    }
    if (!runReport.isMachine()) {
      runReport.diagnostic("NAME".padEnd(35) + "VERSION".padEnd(12) + "API".padEnd(10) + "STATUS".padEnd(12) + "PERMISSIONS");
      runReport.diagnostic("-".repeat(90));
      for (const plugin of plugins) {
        runReport.diagnostic(
          plugin.name.padEnd(35)
          + plugin.version.padEnd(12)
          + plugin.apiVersion.padEnd(10)
          + (plugin.compatible ? "active" : "incompatible").padEnd(12)
          + plugin.permissions.join(", "),
        );
      }
    }
    return;
  }

  const pluginName = name || "my-plugin";
  const baseDir = pluginBaseDir(options, context);
  const outputDir = path.join(baseDir, "plugins", pluginName);
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0 && options.force !== true) {
    throw new UsageError(`Plugin directory '${outputDir}' already exists and is not empty. Pass --force to overwrite.`);
  }
  if (!runReport.isMachine()) runReport.diagnostic(`Scaffolding new plugin '${pluginName}' (type: ${options.type ?? "effect"}) in ${outputDir}...`);
  const result = scaffoldPlugin({
    name: pluginName,
    type: options.type ?? "effect",
    description: options.desc,
    author: options.author,
    outputDir,
  });
  for (const file of result.files) {
    runReport.artifact({ kind: "plugin", path: file, units: 1, unit: "file" });
  }
  runReport.result({ action: "init", target: result.targetDir, files: result.files });
  if (!runReport.isMachine()) {
    runReport.diagnostic(`✔ Created plugin project in: ${result.targetDir}`);
    for (const file of result.files) runReport.diagnostic(`  + ${file}`);
    runReport.diagnostic("\nNext steps:");
    runReport.diagnostic(`  cd ${path.relative(process.cwd(), result.targetDir) || "."}`);
    runReport.diagnostic("  pnpm install");
    runReport.diagnostic("  pnpm run dev");
  }
}

