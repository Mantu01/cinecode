import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export function createCreateCommand(): Command {
  const cmd = new Command("create")
    .description("Create a new Cinecode project")
    .argument("<directory>", "Target directory")
    .option("--ts", "Use TypeScript (default)", false)
    .option("--js", "Use JavaScript", false)
    .option("--fps <number>", "Frames per second", "30")
    .option("--resolution <preset|WxH>", "Resolution preset or WxH", "1920x1080")
    .option("--no-git", "Skip git initialization")
    .option("-f, --force", "Proceed even if directory is not empty", false)
    .option("--dry-run", "Print plan without writing files", false)
    .option("-v, --verbose", "Verbose output", false)
    .action(async (directory: string, opts: { ts?: boolean; js?: boolean; fps?: string; resolution?: string; git?: boolean; force?: boolean; dryRun?: boolean; verbose?: boolean }) => {
      const args = ["create-cinecode@latest", directory];

      if (opts.ts) args.push("--ts");
      if (opts.js) args.push("--js");
      if (opts.fps) args.push("--fps", opts.fps);
      if (opts.resolution) args.push("--resolution", opts.resolution);
      if (opts.git === false) args.push("--no-git");
      if (opts.force) args.push("-f");
      if (opts.dryRun) args.push("--dry-run");
      if (opts.verbose) args.push("-v");

      try {
        const result = spawnSync("npx", args, { stdio: "inherit", cwd: resolve(directory, ".."), shell: true });
        if (result.status !== 0) {
          process.exit(result.status ?? 1);
        }
      } catch (e) {
        console.error("Failed to create project. Try running 'npx create-cinecode@latest' directly.");
        process.exit(1);
      }
    });

  return cmd;
}