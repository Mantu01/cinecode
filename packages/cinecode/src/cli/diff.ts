import { Command } from "commander";
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
      const data = JSON.parse(fs.readFileSync(absPath, "utf8"));
      return { comp: data, label: path.basename(target) };
    }
    const imported = await import(absPath);
    const comp = imported.default || imported.composition || imported;
    return { comp, label: path.basename(target) };
  }

  try {
    const gitContent = execSync(`git show ${target}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    try {
      return { comp: JSON.parse(gitContent), label: target };
    } catch {
      return {
        comp: {
          name: target,
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 10,
          background: "#000000",
          audio: {},
          rootTimeline: { tracks: [] },
        } as unknown as Composition,
        label: target,
      };
    }
  } catch {
    throw new Error(`Unable to resolve composition file or git ref: ${target}`);
  }
}

export function createDiffCommand(): Command {
  const cmd = new Command("diff")
    .description("Semantic comparison between two compositions or git revisions")
    .argument("<sourceA>", "First composition file or git revision")
    .argument("[sourceB]", "Second composition file or git revision (defaults to working copy if sourceA is a git ref)")
    .option("-f, --format <format>", "Output format: text, markdown, json", "text")
    .option("--side-by-side", "Display terminal diff side-by-side", false)
    .action(async (srcA: string, srcB?: string, options = {}) => {
      const targetB = srcB || (fs.existsSync(srcA) ? srcA : "HEAD");
      const targetA = srcB ? srcA : "HEAD";

      try {
        const { comp: compA, label: labelA } = await loadCompositionData(targetA);
        const { comp: compB, label: labelB } = await loadCompositionData(targetB);

        const diff = diffCompositions(compA, compB, labelA, labelB);

        if (options.format === "json") {
          console.log(JSON.stringify(diff, null, 2));
          return;
        }

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
      } catch (err) {
        console.error(pc.red(`Diff error: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  return cmd;
}
