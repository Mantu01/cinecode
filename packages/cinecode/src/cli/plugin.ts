import { Command } from "commander";
import { EXIT_CODES, ExitSignal } from "./exit-codes.js";
import { marketplaceClient } from "../plugin/marketplace/client.js";
import { installPlugin, removePlugin, listInstalledPlugins } from "../plugin/marketplace/installer.js";
import { scaffoldPlugin, type TemplateType } from "../plugin/scaffold/index.js";

export function createPluginCommand(): Command {
  const pluginCmd = new Command("plugin")
    .description("Manage Cinecode marketplace plugins, install, scaffold, and inspect");

  pluginCmd
    .command("search [query]")
    .description("Search official Cinecode plugin marketplace")
    .option("-t, --tag <tag>", "Filter by tag (e.g. audio, transitions, 3d, lut, ai)")
    .option("-k, --kind <kind>", "Filter by plugin kind")
    .action(async (query = "", options) => {
      console.log(`Searching marketplace for "${query}"...\n`);
      const results = await marketplaceClient.searchPlugins(query, {
        tag: options.tag,
        kind: options.kind,
      });

      if (results.length === 0) {
        console.log("No plugins found matching criteria.");
        return;
      }

      console.log("NAME".padEnd(35) + "VERSION".padEnd(12) + "RATING".padEnd(10) + "DOWNLOADS".padEnd(12) + "DESCRIPTION");
      console.log("-".repeat(90));
      for (const r of results) {
        const ratingStr = `★ ${r.rating.toFixed(1)}`;
        console.log(
          r.name.padEnd(35) +
          r.version.padEnd(12) +
          ratingStr.padEnd(10) +
          String(r.downloads).padEnd(12) +
          r.description,
        );
      }
    });

  pluginCmd
    .command("add <packageName>")
    .description("Install and register a plugin from the marketplace or npm")
    .option("--pm <pm>", "Package manager to use (pnpm, npm, yarn)", "pnpm")
    .action(async (packageName, options) => {
      console.log(`Installing '${packageName}'...`);
      const res = await installPlugin(packageName, { pm: options.pm });
      if (res.success) {
        console.log(`✔ ${res.message}`);
      } else {
        console.error(`✖ Failed to install '${packageName}': ${res.message}`);
        throw new ExitSignal(EXIT_CODES.environment);
      }
    });

  pluginCmd
    .command("remove <packageName>")
    .description("Uninstall and unregister a plugin")
    .option("--pm <pm>", "Package manager to use (pnpm, npm, yarn)", "pnpm")
    .action(async (packageName, options) => {
      console.log(`Removing '${packageName}'...`);
      const res = await removePlugin(packageName, { pm: options.pm });
      if (res.success) {
        console.log(`✔ ${res.message}`);
      } else {
        console.error(`✖ Failed to remove '${packageName}': ${res.message}`);
        throw new ExitSignal(EXIT_CODES.environment);
      }
    });

  pluginCmd
    .command("list")
    .description("List all installed plugins and their status")
    .action(async () => {
      const plugins = await listInstalledPlugins();
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
    .option("-t, --type <type>", "Plugin template type: effect, transition, audio-effect, clip-type", "effect")
    .option("-d, --desc <description>", "Plugin description", "")
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
