import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import prompts from "prompts";
import { createError, ErrorCode } from "../errors/index.js";
import { CancellationSignal } from "./exit-codes.js";
import { FRAMEWORK_RANGE } from "../contracts.js";
import { runReport } from "./run-report.js";
import { UsageError } from "./usage-error.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveScaffoldRunner(): { cmd: string; baseArgs: string[] } {
  if (process.env.CINECODE_SCAFFOLD_BIN && existsSync(process.env.CINECODE_SCAFFOLD_BIN)) {
    return { cmd: process.execPath, baseArgs: [process.env.CINECODE_SCAFFOLD_BIN] };
  }

  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve("create-cinecode/package.json");
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as Record<string, unknown>;
    const binMap = pkg.bin as Record<string, string> | string | undefined;
    const binRel = typeof binMap === "string" ? binMap : binMap?.["create-cinecode"];
    if (binRel) {
      const binPath = resolve(dirname(pkgJson), binRel);
      if (existsSync(binPath)) {
        return { cmd: process.execPath, baseArgs: [binPath] };
      }
    }
  } catch {
    // Note: fallback to sibling package or npx if require.resolve fails
    void 0;
  }

  const localDistCli = resolve(__dirname, "../../../create-cinecode/dist/esm/cli.js");
  if (existsSync(localDistCli)) {
    return { cmd: process.execPath, baseArgs: [localDistCli] };
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return { cmd: npx, baseArgs: ["--yes", `create-cinecode@${FRAMEWORK_RANGE}`] };
}

const CONFIG_NAMES = [
  "cinecode.config.ts",
  "cinecode.config.js",
  "cinecode.config.mjs",
  "cinecode.config.cjs",
  "cinecode.json",
];

function findAncestorConfig(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(current, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function getBlockingFiles(targetDir: string): string[] {
  const blocking: string[] = [];
  if (!existsSync(targetDir)) return blocking;
  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      blocking.push(entry.name);
    }
  } catch {
    // Note: ignore readdir failure for blocking directory check
    void 0;
  }
  return blocking;
}

export async function createCommand(directory?: string, opts: {
  ts?: boolean;
  js?: boolean;
  yes?: boolean;
  fps?: number | string;
  resolution?: string;
  git?: boolean;
  localLink?: boolean;
  skipInstall?: boolean;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
} = {}): Promise<void> {
  if (opts.ts && opts.js) {
    throw new UsageError("Conflicting flags: --ts and --js cannot be used together.");
  }

  let targetDir = directory;
  let useJs = opts.js === true;
  let skipInstall = opts.skipInstall;

  const isInteractive = !opts.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (isInteractive) {
    const questions: prompts.PromptObject[] = [];
    if (!targetDir) {
      questions.push({
        type: "text",
        name: "dir",
        message: "Target directory:",
        initial: "cinecode-project",
      });
    }
    if (!opts.ts && !opts.js) {
      questions.push({
        type: "select",
        name: "language",
        message: "Template language:",
        choices: [
          { title: "TypeScript", value: "typescript" },
          { title: "JavaScript", value: "javascript" },
        ],
        initial: 0,
      });
    }
    if (skipInstall === undefined) {
      questions.push({
        type: "confirm",
        name: "install",
        message: "Install dependencies?",
        initial: true,
      });
    }

    if (questions.length > 0) {
      const response = await prompts(questions, {
        onCancel: () => {
          throw new CancellationSignal("init cancelled by user");
        },
      });
      if (response.dir) targetDir = response.dir as string;
      if (response.language) useJs = response.language === "javascript";
      if (response.install !== undefined) skipInstall = !(response.install as boolean);
    }
  }

  const target = resolve(targetDir || "cinecode-project");

  const ancestorConfig = findAncestorConfig(target);
  if (ancestorConfig) {
    throw createError(ErrorCode.CC1003, {
      key: "target directory",
      path: target,
      reason: `Cannot scaffold inside an existing Cinecode project: found config at ${ancestorConfig}. Scaffold in an isolated directory.`,
    });
  }

  const blocking = getBlockingFiles(target);
  if (blocking.length > 0 && !opts.force) {
    throw createError(ErrorCode.CC1003, {
      key: "target directory",
      path: target,
      reason: `Target directory is not empty. Blocking files: ${blocking.join(", ")}. Use --force to proceed.`,
    });
  }

  const runner = resolveScaffoldRunner();
  const args = [...runner.baseArgs, target];

  if (useJs) args.push("--js");
  else args.push("--ts");
  if (opts.fps) args.push("--fps", String(opts.fps));
  if (opts.resolution) args.push("--resolution", opts.resolution);
  if (opts.git === false) args.push("--no-git");
  if (opts.localLink) args.push("--local-link");
  if (skipInstall) args.push("--skip-install");
  if (opts.force) args.push("-f");
  if (opts.dryRun) args.push("--dry-run");
  if (opts.verbose) args.push("-v");

  const result = spawnSync(runner.cmd, args, {
    stdio: ["ignore", runReport.isMachine() ? "pipe" : "inherit", "inherit"],
    cwd: process.cwd(),
  });
  if (result.error) {
    throw createError(ErrorCode.CC7004, { reason: `create-cinecode could not start: ${result.error.message}` }, { cause: result.error });
  }
  if (result.status !== 0) {
    throw createError(ErrorCode.CC7004, { reason: `create-cinecode exited with ${result.status ?? "no status"}` });
  }
  if (!opts.dryRun) runReport.artifact({ kind: "project", path: target, units: 1, unit: "directory" });
  runReport.result({ directory: target, dryRun: opts.dryRun === true });
}

export function createCreateCommand(): Command {
  const spec = findCommand("create");
  if (!spec) throw new Error("Command 'create' not found in registry");
  return buildCommanderCommand(spec);
}
