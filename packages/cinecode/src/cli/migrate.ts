import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { ConfigMigrationEngine } from "../config/migration/engine.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { runReport } from "./run-report.js";

export function createMigrateCommand(): Command {
  const cmd = new Command("migrate")
    .description("Automatically migrate cinecode.config schema to the latest version")
    .argument("[configFile]", "Path to config file", "cinecode.config.ts")
    .option("--dry-run", "Preview the migration without writing files", false)
    .action(async (configFile: string, options: { dryRun?: boolean }) => {
      let resolved = path.resolve(configFile);
      if (!fs.existsSync(resolved)) {
        const jsVariant = path.resolve("cinecode.config.js");
        const jsonVariant = path.resolve("cinecode.config.json");
        if (fs.existsSync(jsVariant)) resolved = jsVariant;
        else if (fs.existsSync(jsonVariant)) resolved = jsonVariant;
      }

      runReport.setProject({ root: process.cwd(), config: resolved });
      if (options.dryRun !== true) runReport.expectArtifact("config");
      console.log(`Migrating configuration: ${pc.cyan(resolved)}...`);

      try {
        const engine = new ConfigMigrationEngine();
        const result = engine.migrate(resolved, { dryRun: options.dryRun === true });
        runReport.result({ originalVersion: result.originalVersion, targetVersion: result.targetVersion, dryRun: options.dryRun === true });
        if (options.dryRun !== true) runReport.artifact({ kind: "config", path: resolved, units: result.appliedSteps.length, unit: "steps" });

        console.log(pc.green(`✔ Successfully migrated schema from v${result.originalVersion} to v${result.targetVersion}`));
        if (options.dryRun === true) {
          console.log(pc.dim("Dry run — no files were modified"));
        } else {
          console.log(pc.dim(`Backup created at: ${result.backupPath}`));
        }

        if (result.appliedSteps.length > 0) {
          console.log("\nApplied Migrations:");
          for (const step of result.appliedSteps) {
            console.log(pc.bold(`\n  v${step.fromVersion} -> v${step.toVersion}:`));
            for (const ch of step.changes) {
              console.log(`    • ${ch}`);
            }
          }
          if (options.dryRun === true) {
            console.log(pc.dim("\nResulting configuration:"));
            console.log(result.newContent);
          }
        } else {
          console.log(pc.dim("\nConfiguration is already up-to-date with latest schema."));
        }
      } catch (error) {
        if (isCinecodeError(error)) throw error;
        throw createError(
          ErrorCode.CC1006,
          { path: resolved, reason: error instanceof Error ? error.message : String(error) },
          { location: { file: resolved }, cause: error },
        );
      }
    });

  return cmd;
}
