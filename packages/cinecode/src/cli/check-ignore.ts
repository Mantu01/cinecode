import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadCinecodeIgnore, type IgnoreRule } from "../config/ignore.js";
import { loadProjectContext } from "./project-context.js";

export function createCheckIgnoreCommand(): Command {
  const cmd = new Command("check-ignore")
    .description("Check if paths match .cinecodeignore exclusion rules")
    .argument("<paths...>", "One or more file or directory paths to test")
    .option("-v, --verbose", "Show detailed rule matching and line numbers", false)
    .action(async (paths: string[], options, command: Command) => {
      const merged = { ...command.optsWithGlobals(), ...options } as { root?: string; config?: string };
      const context = await loadProjectContext({ root: merged.root, config: merged.config });
      const projectRoot = context.root;
      const ignore = loadCinecodeIgnore(projectRoot);
      const rules = ignore.getRules();

      let hasIgnored = false;

      for (const targetPath of paths) {
        const relPath = path.relative(projectRoot, path.resolve(projectRoot, targetPath)).replace(/\\/g, "/");
        const isIgnored = ignore.shouldIgnore(relPath);

        if (isIgnored) {
          hasIgnored = true;
          let matchedRule: IgnoreRule | null = null;
          for (const rule of rules) {
            const tempIgnore = new (ignore.constructor as any)({ patterns: [rule.pattern], useDefaults: false });
            if (tempIgnore.shouldIgnore(relPath)) {
              matchedRule = rule;
            }
          }

          if (options.verbose && matchedRule) {
            console.log(
              `${pc.red("IGNORED")} ${pc.cyan(relPath)} ${pc.dim(`(matched pattern "${matchedRule.pattern}" at line ${matchedRule.lineNumber})`)}`,
            );
          } else {
            console.log(`${pc.red("IGNORED")} ${relPath}`);
          }
        } else {
          if (options.verbose) {
            console.log(`${pc.green("INCLUDED")} ${pc.cyan(relPath)} ${pc.dim("(no ignore pattern matched)")}`);
          }
        }
      }

      if (!hasIgnored && !options.verbose) {
        console.log(pc.green("None of the specified paths are ignored."));
      }
    });

  return cmd;
}
