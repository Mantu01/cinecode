import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import { ConfigMigrationEngine, formatDiffSummary } from "../config/migration/engine.js";
import { resolveProjectLocation } from "../config/project.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { runReport } from "./run-report.js";

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export async function migrateCommand(
  targetOrOptions?: string | { dryRun?: boolean; backup?: boolean; yes?: boolean; root?: string; config?: string },
  rawOptions: { dryRun?: boolean; backup?: boolean; yes?: boolean; root?: string; config?: string } = {},
): Promise<void> {
  let configFile: string | undefined;
  let options = rawOptions;

  if (typeof targetOrOptions === "object" && targetOrOptions !== null) {
    options = { ...targetOrOptions, ...rawOptions };
    configFile = options.config;
  } else if (typeof targetOrOptions === "string") {
    configFile = targetOrOptions;
  }

  const explicitFile = configFile && fs.existsSync(path.resolve(configFile)) ? configFile : undefined;
  const location = resolveProjectLocation({ root: options.root, config: options.config ?? explicitFile });
  const resolved = location.configPath;

  runReport.setProject({ root: location.root, config: resolved });
  if (options.dryRun !== true) runReport.expectArtifact("config");
  console.log(`Migrating configuration: ${pc.cyan(resolved)}...`);

  try {
    const engine = new ConfigMigrationEngine();
    const preview = engine.migrate(resolved, { dryRun: true });

    if (!preview.modified) {
      runReport.result({
        originalVersion: preview.originalVersion,
        targetVersion: preview.targetVersion,
        dryRun: options.dryRun === true,
        modified: false,
        diff: [],
      });
      console.log(pc.green(`✔ Configuration is already up-to-date (v${preview.targetVersion}). No changes needed.`));
      return;
    }

    console.log(pc.bold("\nProposed Migration Changes:"));
    console.log(formatDiffSummary(preview.diff));

    if (options.dryRun === true) {
      runReport.result({
        originalVersion: preview.originalVersion,
        targetVersion: preview.targetVersion,
        dryRun: true,
        modified: true,
        diff: preview.diff,
        newContent: preview.newContent,
      });
      console.log(pc.dim("\nDry run — no files were modified"));
      console.log(pc.dim("\nResulting configuration:"));
      console.log(preview.newContent);
      return;
    }

    if (!options.yes) {
      if (process.stdin.isTTY) {
        const { confirmed } = await prompts({
          type: "confirm",
          name: "confirmed",
          message: `Apply migration changes to ${path.basename(resolved)}?`,
          initial: true,
        });
        if (!confirmed) {
          console.log(pc.yellow("Migration cancelled."));
          return;
        }
      } else {
        throw createError(
          ErrorCode.CC0001,
          { reason: "In-place migration in non-interactive environment requires --yes flag" },
          { location: { file: resolved } },
        );
      }
    }

    const result = engine.migrate(resolved, { dryRun: false, backup: options.backup === true });
    runReport.result({
      originalVersion: result.originalVersion,
      targetVersion: result.targetVersion,
      dryRun: false,
      modified: true,
      diff: result.diff,
    });
    runReport.artifact({ kind: "config", path: resolved, units: result.appliedSteps.length, unit: "steps" });

    console.log(pc.green(`✔ Successfully migrated schema from v${result.originalVersion} to v${result.targetVersion}`));
    if (result.backupPath) {
      console.log(pc.dim(`Backup created at: ${result.backupPath}`));
    }
  } catch (error) {
    if (isCinecodeError(error)) throw error;
    throw createError(
      ErrorCode.CC1006,
      { path: resolved, reason: error instanceof Error ? error.message : String(error) },
      { location: { file: resolved }, cause: error },
    );
  }
}

export function createMigrateCommand(): Command {
  const spec = findCommand("migrate");
  if (!spec) throw new Error("Command 'migrate' not found in registry");
  return buildCommanderCommand(spec);
}
