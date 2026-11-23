import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pc } from "../output/palette.js";
import { diffCompositions, formatDiffMarkdown } from "../../core/diff/engine.js";
import type { Composition } from "../../core/types/index.js";

const REVISION_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)?|HEAD(?:[~^][0-9]*)?|[0-9a-f]{7,40})$/;

function assertRevision(revision: string): void {
  if (!REVISION_PATTERN.test(revision)) {
    throw createError(ErrorCode.CC0001, {
      reason: `Invalid git revision '${revision}'. Pass a branch, tag, HEAD[~n], or a 7-40 character commit hash.`,
    });
  }
}

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
      const imported = await import(pathToFileURL(absPath).href);
      const comp = imported.default || imported.composition || imported;
      return { comp, label: path.basename(target) };
    } catch (error) {
      throw createError(ErrorCode.CC3008, { path: absPath, expected: "a composition export" }, { location: { file: absPath }, cause: error });
    }
  }

  assertRevision(target);
  try {
    const gitContent = execFileSync("git", ["show", target], { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
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


export async function diffCommand(srcA: string, srcB?: string, options: { format?: string; sideBySide?: boolean; json?: boolean } = {}): Promise<void> {
  const targetB = srcB || (fs.existsSync(srcA) ? srcA : "HEAD");
  const targetA = srcB ? srcA : "HEAD";

  const { comp: compA, label: labelA } = await loadCompositionData(targetA);
  const { comp: compB, label: labelB } = await loadCompositionData(targetB);

  const diff = diffCompositions(compA, compB, labelA, labelB);
  runReport.result({ diff });

  if (options.json) return;

  if (options.format === "markdown") {
    runReport.diagnostic(formatDiffMarkdown(diff));
    return;
  }

  if (options.sideBySide) {
    runReport.diagnostic(`\n${labelA.padEnd(40)} | ${labelB}`);
    runReport.diagnostic(`${`+${diff.summary.added} -${diff.summary.removed} ~${diff.summary.moved} *${diff.summary.modified}`.padEnd(40)} | ${diff.changes.length} change(s)`);
  }
  runReport.diagnostic(`\nSemantic Diff: ${pc.bold(labelA)} -> ${pc.bold(labelB)}`);
  runReport.diagnostic(`Summary: ${pc.green(`+${diff.summary.added} added`)}, ${pc.red(`-${diff.summary.removed} removed`)}, ${pc.yellow(`~${diff.summary.moved} moved`)}, ${pc.blue(`*${diff.summary.modified} modified`)}\n`);

  if (diff.changes.length === 0) {
    runReport.diagnostic(pc.green("✔ Compositions are semantically identical."));
    return;
  }

  for (const change of diff.changes) {
    switch (change.type) {
      case "clip_added":
        runReport.diagnostic(pc.green(`  + [ADDED]    ${change.description}`));
        break;
      case "clip_removed":
        runReport.diagnostic(pc.red(`  - [REMOVED]  ${change.description}`));
        break;
      case "clip_moved":
        runReport.diagnostic(pc.yellow(`  ~ [MOVED]    ${change.description}`));
        break;
      default:
        runReport.diagnostic(pc.blue(`  * [MODIFIED] ${change.description}`));
        break;
    }
  }
  runReport.diagnostic("");
}

