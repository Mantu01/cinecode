import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { scaffoldPlugin, type TemplateType } from "../plugin/scaffold/index.js";

export interface InstalledPluginInfo {
  readonly name: string;
  readonly version: string;
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
      if (depName.startsWith("@cinecode/plugin-") || depName.includes("cinecode-plugin")) {
        let permissions: string[] = ["frame:process"];
        let kind = "effect";
        let description = "";
        const depPkgPath = path.join(projectDir, "node_modules", depName, "package.json");
        if (fs.existsSync(depPkgPath)) {
          try {
            const depPkg = JSON.parse(fs.readFileSync(depPkgPath, "utf8"));
            if (depPkg.cinecode) {
              if (depPkg.cinecode.permissions) permissions = depPkg.cinecode.permissions;
              if (depPkg.cinecode.kind) kind = depPkg.cinecode.kind;
              if (depPkg.cinecode.description) description = depPkg.cinecode.description;
            }
          } catch {}
        }
        result.push({
          name: depName,
          version: String(version),
          active: true,
          permissions,
          kind,
          description,
        });
      }
    }
  } catch {}
  return result;
}

export function createPluginCommand(): Command {
  const pluginCmd = new Command("plugin")
    .description("Inspect and scaffold local Cinecode plugins");

  pluginCmd
    .command("list")
    .description("List all installed plugins and their status")
    .action(() => {
      const plugins = listInstalledPlugins();
      if (plugins.length === 0) {
        console.log("No Cinecode plugins installed in project.");
        return;
      }

      console.log("NAME".padEnd(35) + "VERSION".padEnd(12) + "STATUS".padEnd(12) + "PERMISSIONS");
      console.log("-".repeat(80));
      for (const p of plugins) {
        const status = p.active ? "active" : "inactive";
        const perms = p.permissions.join(", ");
        console.log(
          p.name.padEnd(35) +
          p.version.padEnd(12) +
          status.padEnd(12) +
          perms,
        );
      }
    });

  pluginCmd
    .command("init <pluginName>")
    .description("Scaffold a new Cinecode plugin starter kit")
    .option("--type <type>", "Plugin template type: effect, transition, audio-effect, clip-type", "effect")
    .option("--desc <description>", "Plugin description", "")
    .option("-a, --author <author>", "Author name", "")
    .action((pluginName, options) => {
      console.log(`Scaffolding new plugin '${pluginName}' (type: ${options.type})...`);
      const result = scaffoldPlugin({
        name: pluginName,
        type: options.type as TemplateType,
        description: options.desc,
        author: options.author,
      });

      console.log(`✔ Created plugin project in: ${result.targetDir}`);
      for (const f of result.files) {
        console.log(`  + ${f}`);
      }
      console.log("\nNext steps:");
      console.log(`  cd ${pluginName}`);
      console.log("  pnpm install");
      console.log("  pnpm run dev");
    });

  return pluginCmd;
}
