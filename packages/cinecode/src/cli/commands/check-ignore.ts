import type { Command } from "commander";
import path from "node:path";
import { pc } from "../output/palette.js";
import { loadCinecodeIgnore } from "../../config/ignore.js";
import { loadProjectContext } from "../resolve/project-context.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";
import { createError, ErrorCode } from "../../errors/index.js";

interface CheckIgnoreOptions {
  readonly verbose?: boolean;
  readonly root?: string;
  readonly config?: string;
}

export async function checkIgnoreCommand(
  positional: unknown,
  options: CheckIgnoreOptions = {},
  context?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const paths = (Array.isArray(positional) ? positional : [positional])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (paths.length === 0) {
    throw new UsageError("check-ignore requires at least one path, e.g. `cinecode check-ignore output/intro.mp4`.");
  }
  const projectRoot = context?.resolution?.root ?? (await loadProjectContext({ root: options.root, config: options.config })).root;
  const ignore = loadCinecodeIgnore(projectRoot);
  const ignored: Array<{ path: string; rule: string; line: number }> = [];
  const included: string[] = [];

  for (const targetPath of paths) {
    const absolute = path.resolve(projectRoot, targetPath);
    const relativePath = path.relative(projectRoot, absolute).replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new UsageError(`Path '${targetPath}' is outside the project root; check-ignore accepts paths relative to the project.`);
    }
    const rule = ignore.matchRule(relativePath);
    if (rule) {
      ignored.push({ path: relativePath, rule: rule.pattern, line: rule.lineNumber });
      if (!runReport.isMachine()) {
        runReport.diagnostic(options.verbose
          ? `${pc.red("IGNORED")} ${pc.cyan(relativePath)} ${pc.dim(`(matched pattern "${rule.pattern}" at line ${rule.lineNumber})`)}`
          : `${pc.red("IGNORED")} ${relativePath}`);
      }
    } else {
      included.push(relativePath);
      if (!runReport.isMachine() && options.verbose) {
        runReport.diagnostic(`${pc.green("INCLUDED")} ${pc.cyan(relativePath)} ${pc.dim("(no ignore pattern matched)")}`);
      }
    }
  }

  const results = [
    ...ignored.map((entry) => ({ path: entry.path, ignored: true, rule: entry.rule, line: entry.line })),
    ...included.map((entry) => ({ path: entry, ignored: false })),
  ];
  runReport.result({ hasIgnored: ignored.length > 0, paths: results, ignored: ignored.map((entry) => entry.path), included });

  if (ignored.length === 0 && !options.verbose && !runReport.isMachine()) {
    runReport.diagnostic(pc.green("None of the specified paths are ignored."));
  }
  if (ignored.length > 0) throw createError(ErrorCode.CC4012, { path: ignored.map((entry) => entry.path).join(", ") });
}

