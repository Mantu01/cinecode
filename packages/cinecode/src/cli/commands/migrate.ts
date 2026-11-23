import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pc } from "../output/palette.js";
import prompts from "prompts";
import { ConfigMigrationEngine, formatDiffSummary } from "../../config/migration/engine.js";
import { resolveProjectLocation } from "../../config/project.js";
import { createError, ErrorCode, isCinecodeError } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";


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
  if (!runReport.isMachine()) runReport.diagnostic(`Migrating configuration: ${pc.cyan(resolved)}...`);

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
      if (!runReport.isMachine()) runReport.diagnostic(pc.green(`✔ Configuration is already up-to-date (v${preview.targetVersion}). No changes needed.`));
      return;
    }

    if (!runReport.isMachine()) {
      runReport.diagnostic(pc.bold("\nProposed Migration Changes:"));
      runReport.diagnostic(formatDiffSummary(preview.diff));
    }

    if (options.dryRun === true) {
      runReport.result({
        originalVersion: preview.originalVersion,
        targetVersion: preview.targetVersion,
        dryRun: true,
        modified: true,
        diff: preview.diff,
        newContent: preview.newContent,
      });
      if (!runReport.isMachine()) {
        runReport.diagnostic(pc.dim("\nDry run — no files were modified"));
        runReport.diagnostic(pc.dim("\nResulting configuration:"));
        runReport.diagnostic(preview.newContent);
      }
      return;
    }

    if (!options.yes) {
      if (process.stdin.isTTY && !runReport.isMachine()) {
        const { confirmed } = await prompts({
          type: "confirm",
          name: "confirmed",
          message: `Apply migration changes to ${path.basename(resolved)}?`,
          initial: true,
        });
        if (!confirmed) {
          runReport.diagnostic(pc.yellow("Migration cancelled."));
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

    runReport.expectArtifact("config");
    const result = engine.migrate(resolved, { dryRun: false, backup: options.backup === true });
    runReport.result({
      originalVersion: result.originalVersion,
      targetVersion: result.targetVersion,
      dryRun: false,
      modified: true,
      diff: result.diff,
    });
    runReport.artifact({ kind: "config", path: resolved, units: result.appliedSteps.length, unit: "steps" });

    if (!runReport.isMachine()) {
      runReport.diagnostic(pc.green(`✔ Successfully migrated schema from v${result.originalVersion} to v${result.targetVersion}`));
      if (result.backupPath) {
        runReport.diagnostic(pc.dim(`Backup created at: ${result.backupPath}`));
      }
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

