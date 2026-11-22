import { Command } from "commander";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pc from "picocolors";
import { diffCompositions, formatDiffMarkdown } from "../core/diff/engine.js";
import type { Composition } from "../core/types/index.js";

async function loadCompositionData(target: string): Promise<{ comp: Composition; label: string }> {
  if (fs.existsSync(target)) {
    const absPath = path.resolve(target);
    if (absPath.endsWith(".json")) {
      try {
        return { comp: JSON.parse(fs.readFileSync(absPath, "utf8")), label: path.basename(target) };
      } catch (error) {
        throw createError(ErrorCode.CC1006, { path: absPath, reason: error instanceof Error ? error.message : String(error) }, { location: { file: absPath }, cause: error });
      }
    }
    try {
      const imported = await import(absPath);
      const comp = imported.default || imported.composition || imported;
      return { comp, label: path.basename(target) };
    } catch (error) {
      throw createError(ErrorCode.CC3008, { path: absPath, expected: "a composition export" }, { location: { file: absPath }, cause: error });
    }
  }

  try {
    const gitContent = execSync(`git show ${target}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    try {
      return { comp: JSON.parse(gitContent), label: target };
    } catch (error) {
      throw createError(ErrorCode.CC1006, { path: target, reason: "git revision content is not a JSON composition" }, { cause: error });
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) throw error;
    throw createError(ErrorCode.CC1009, { path: target }, { cause: error });
  }
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export async function diffCommand(srcA: string, srcB?: string, options: { format?: string; sideBySide?: boolean; json?: boolean } = {}): Promise<void> {
  const targetB = srcB || (fs.existsSync(srcA) ? srcA : "HEAD");
  const targetA = srcB ? srcA : "HEAD";

  const { comp: compA, label: labelA } = await loadCompositionData(targetA);
  const { comp: compB, label: labelB } = await loadCompositionData(targetB);

  const diff = diffCompositions(compA, compB, labelA, labelB);
  runReport.result({ ...diff });

  if (options.json) return;

  if (options.format === "markdown") {
    console.log(formatDiffMarkdown(diff));
    return;
  }

  console.log(`\nSemantic Diff: ${pc.bold(labelA)} -> ${pc.bold(labelB)}`);
  console.log(`Summary: ${pc.green(`+${diff.summary.added} added`)}, ${pc.red(`-${diff.summary.removed} removed`)}, ${pc.yellow(`~${diff.summary.moved} moved`)}, ${pc.blue(`*${diff.summary.modified} modified`)}\n`);

  if (diff.changes.length === 0) {
    console.log(pc.green("✔ Compositions are semantically identical."));
    return;
  }

  for (const change of diff.changes) {
    switch (change.type) {
      case "clip_added":
        console.log(pc.green(`  + [ADDED]    ${change.description}`));
        break;
      case "clip_removed":
        console.log(pc.red(`  - [REMOVED]  ${change.description}`));
        break;
      case "clip_moved":
        console.log(pc.yellow(`  ~ [MOVED]    ${change.description}`));
        break;
      default:
        console.log(pc.blue(`  * [MODIFIED] ${change.description}`));
        break;
    }
  }
  console.log();
}

export function createDiffCommand(): Command {
  const spec = findCommand("diff");
  if (!spec) throw new Error("Command 'diff' not found in registry");
  return buildCommanderCommand(spec);
}
