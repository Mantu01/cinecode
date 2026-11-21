import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { UsageError } from "./usage-error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveScaffoldRunner(): { cmd: string; baseArgs: string[] } {
  const localDistCli = resolve(__dirname, "../../../create-cinecode/dist/esm/cli.js");
  if (existsSync(localDistCli)) {
    return { cmd: process.execPath, baseArgs: [localDistCli] };
  }
  throw createError(
    ErrorCode.CC7004,
    { reason: "Local create-cinecode scaffolder is missing" },
    { fixHint: "Install it in the workspace with `pnpm --filter create-cinecode build`, then rerun `cinecode create`." },
  );
}

export function createCreateCommand(): Command {
  const cmd = new Command("create")
    .description("Create a new Cinecode project")
    .argument("<directory>", "Target directory")
    .option("--ts", "Use TypeScript (default)", false)
    .option("--js", "Use JavaScript", false)
    .option("--fps <number>", "Frames per second", "30")
    .option("--resolution <preset|WxH>", "Resolution preset or WxH", "1920x1080")
    .option("--no-git", "Skip git initialization")
    .option("--local-link", "Link local workspace dependency", false)
    .option("--skip-install", "Skip dependency installation", false)
    .option("--force", "Proceed even if directory is not empty", false)
    .option("--dry-run", "Print plan without writing files", false)
    .option("-v, --verbose", "Verbose output", false)
    .action(async (directory: string, opts: {
      ts?: boolean;
      js?: boolean;
      fps?: string;
      resolution?: string;
      git?: boolean;
      localLink?: boolean;
      skipInstall?: boolean;
      force?: boolean;
      dryRun?: boolean;
      verbose?: boolean;
    }) => {
      if (opts.ts && opts.js) {
        throw new UsageError("Conflicting flags: --ts and --js cannot be used together.");
      }
      const target = resolve(directory);
      const runner = resolveScaffoldRunner();
      const args = [...runner.baseArgs, target];

      if (opts.ts) args.push("--ts");
      if (opts.js) args.push("--js");
      if (opts.fps) args.push("--fps", opts.fps);
      if (opts.resolution) args.push("--resolution", opts.resolution);
      if (opts.git === false) args.push("--no-git");
      if (opts.localLink) args.push("--local-link");
      if (opts.skipInstall) args.push("--skip-install");
      if (opts.force) args.push("-f");
      if (opts.dryRun) args.push("--dry-run");
      if (opts.verbose) args.push("-v");

      if (!opts.dryRun) runReport.expectArtifact("project");
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
    });

  return cmd;
}
