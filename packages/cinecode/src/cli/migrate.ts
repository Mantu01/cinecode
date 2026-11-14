import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { ConfigMigrationEngine } from "../config/migration/engine.js";

export function createMigrateCommand(): Command {
  const cmd = new Command("migrate")
    .description("Automatically migrate cinecode.config schema to the latest version")
    .argument("[configFile]", "Path to config file", "cinecode.config.ts")
    .action(async (configFile: string) => {
      let resolved = path.resolve(configFile);
      if (!fs.existsSync(resolved)) {
        const jsVariant = path.resolve("cinecode.config.js");
        const jsonVariant = path.resolve("cinecode.config.json");
        if (fs.existsSync(jsVariant)) resolved = jsVariant;
        else if (fs.existsSync(jsonVariant)) resolved = jsonVariant;
      }

      console.log(`Migrating configuration: ${pc.cyan(resolved)}...`);

      try {
        const engine = new ConfigMigrationEngine();
        const result = engine.migrate(resolved);

        console.log(pc.green(`✔ Successfully migrated schema from v${result.originalVersion} to v${result.targetVersion}`));
        console.log(pc.dim(`Backup created at: ${result.backupPath}`));

        if (result.appliedSteps.length > 0) {
          console.log("\nApplied Migrations:");
          for (const step of result.appliedSteps) {
            console.log(pc.bold(`\n  v${step.fromVersion} -> v${step.toVersion}:`));
            for (const ch of step.changes) {
              console.log(`    • ${ch}`);
            }
          }
        } else {
          console.log(pc.dim("\nConfiguration is already up-to-date with latest schema."));
        }
      } catch (err: any) {
        console.error(pc.red(`\n✖ Migration failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  return cmd;
}
