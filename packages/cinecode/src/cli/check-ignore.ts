import type { Command } from "commander";
import path from "node:path";
import pc from "picocolors";
import { loadCinecodeIgnore, type IgnoreRule } from "../config/ignore.js";
import { loadProjectContext } from "./project-context.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

export async function checkIgnoreCommand(paths: string[], options: { verbose?: boolean; root?: string; config?: string } = {}): Promise<void> {
  const context = await loadProjectContext({ root: options.root, config: options.config });
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
        const tempIgnore = new (ignore.constructor as new (opts: unknown) => { shouldIgnore: (p: string) => boolean })({ patterns: [rule.pattern], useDefaults: false });
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
}

export function createCheckIgnoreCommand(): Command {
  const spec = findCommand("check-ignore");
  if (!spec) throw new Error("Command 'check-ignore' not found in registry");
  return buildCommanderCommand(spec);
}
