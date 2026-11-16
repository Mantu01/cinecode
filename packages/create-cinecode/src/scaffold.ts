import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  constants,
  accessSync,
} from "node:fs";
import { resolve, relative, dirname, basename } from "node:path";
import { __dirname } from "./meta.js";
import { detectPackageManager, getInstallCommand, getRunCommand } from "./detect-pm.js";
import type { PackageManager } from "./detect-pm.js";
import { selectLanguage } from "./prompt.js";
import type { Language } from "./prompt.js";

export const CREATE_CINECODE_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
).version;

export interface ScaffoldOptions {
  readonly targetDir: string;
  readonly language: Language;
  readonly fps: number;
  readonly resolution: string;
  readonly noGit: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly pm: PackageManager;
  readonly skipInstall?: boolean;
}

export interface FilePlan {
  readonly path: string;
  readonly content: string;
}

export interface ScaffoldPlan {
  readonly files: readonly FilePlan[];
  readonly folders: readonly string[];
  readonly gitignoreEntries: readonly string[];
  readonly gitInit: boolean;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function getTemplateDir(language: Language): string {
  return resolve(__dirname, "templates", language);
}

function listTemplateFiles(language: Language): string[] {
  const files: string[] = [];

  function walk(dir: string, prefix: string): void {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(resolve(dir, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  }

  walk(getTemplateDir(language), "");
  return files;
}

function resolveCinecodeDep(): string {
  return `^${CREATE_CINECODE_VERSION}`;
}

function generateScaffoldPlan(options: ScaffoldOptions): ScaffoldPlan {
  const { targetDir, language, fps, resolution, noGit } = options;

  const isTypeScript = language === "typescript";
  const [width, height] = resolution.split("x").map(Number);

  const vars = {
    FPS: String(fps),
    RESOLUTION: resolution,
    WIDTH: String(width),
    HEIGHT: String(height),
    EXT: isTypeScript ? "ts" : "js",
    CONFIG_EXT: isTypeScript ? "ts" : "js",
    LANGUAGE: language,
    CINECODE_DEP: resolveCinecodeDep(),
    PROJECT_NAME: basename(targetDir),
  };

  const files: FilePlan[] = [];
  for (const relPath of listTemplateFiles(language)) {
    const content = readFileSync(resolve(getTemplateDir(language), relPath), "utf-8");
    const rendered = content.includes("{{") ? renderTemplate(content, vars) : content;
    files.push({ path: resolve(targetDir, relPath), content: rendered });
  }

  const folders = [
    "src/timelines",
    "src/scenes",
    "src/images",
    "src/audio",
    "src/components",
    "src/animations",
    "src/effects",
    "src/transitions",
    "src/sounds",
    "src/fonts",
    "media",
    "output",
    ".cinecode/cache",
  ].map((dir) => resolve(targetDir, dir));

  const gitignoreEntries = ["media", "output", ".cinecode/cache"];

  const gitInit = !noGit && !existsSync(resolve(targetDir, ".git"));

  return { files, folders, gitignoreEntries, gitInit };
}

async function checkTargetDir(targetDir: string, force: boolean): Promise<string[]> {
  const blocking: string[] = [];

  if (!existsSync(targetDir)) {
    return blocking;
  }

  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === ".cinecode") continue;
      blocking.push(entry.name);
    }
  } catch {
    void 0;
  }

  if (blocking.length > 0 && !force) {
    throw new Error(
      `Target directory is not empty. Blocking files: ${blocking.join(", ")}. Use --force to proceed.`,
    );
  }

  return blocking;
}

async function executePlan(plan: ScaffoldPlan, options: ScaffoldOptions): Promise<void> {
  const { targetDir, verbose } = options;

  for (const folder of plan.folders) {
    if (verbose) console.log(`mkdir ${relative(process.cwd(), folder)}`);
    mkdirSync(folder, { recursive: true });
  }

  for (const file of plan.files) {
    const relPath = relative(process.cwd(), file.path);
    if (verbose) console.log(`write ${relPath}`);
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf-8");
  }

  if (plan.gitInit) {
    if (verbose) console.log("git init");
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: targetDir, stdio: "pipe" });
  }

  if (plan.gitignoreEntries.length > 0) {
    const gitignorePath = resolve(targetDir, ".gitignore");
    let existingContent = "";
    try {
      accessSync(gitignorePath, constants.R_OK);
      existingContent = readFileSync(gitignorePath, "utf-8");
    } catch {
      void 0;
    }

    const lines = existingContent.split(/\r?\n/).filter((l) => l.trim() !== "");
    const existingEntries = new Set(lines.map((l) => l.trim()));
    const newEntries = plan.gitignoreEntries.filter((e) => !existingEntries.has(e));

    if (newEntries.length > 0) {
      let newContent = existingContent;
      if (newContent && !newContent.endsWith("\n")) newContent += "\n";
      if (newContent && existingContent.trim() !== "") newContent += "\n";
      newContent += "# Cinecode\n";
      for (const entry of newEntries) {
        newContent += `${entry}\n`;
      }
      newContent += "# End Cinecode\n";
      writeFileSync(gitignorePath, newContent, "utf-8");
      if (verbose) console.log("write .gitignore (updated)");
    }
  }
}

async function installDependencies(
  targetDir: string,
  pm: PackageManager,
  verbose: boolean,
): Promise<void> {
  const installCmd = getInstallCommand(pm);
  if (verbose) console.log(`run ${installCmd.join(" ")}`);
  const { spawnSync } = await import("node:child_process");
  const cmd = installCmd[0] ?? "npm";
  const args = installCmd.slice(1);
  const result = spawnSync(cmd, args, {
    cwd: targetDir,
    stdio: verbose ? "inherit" : "pipe",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`Dependency installation failed with code ${result.status}`);
  }
}

async function runDoctor(verbose: boolean): Promise<void> {
  if (verbose) console.log("doctor check skipped (run 'cinecode doctor' manually)");
}

function printNextSteps(targetDir: string, pm: PackageManager): void {
  const dirName = basename(resolve(targetDir));
  const cdCmd = `cd ${dirName}`;
  const devCmd = getRunCommand(pm, "dev");
  const renderCmd = getRunCommand(pm, "render");
  const generateCmd = getRunCommand(pm, "generate:all");

  console.log("");
  console.log("Project created successfully!");
  console.log("");
  console.log("Next steps:");
  console.log(`  ${cdCmd}`);
  console.log(`  ${devCmd}          Start the dev server`);
  console.log(`  ${renderCmd}       Render every timeline`);
  console.log(`  ${generateCmd}     Generate images, audio and scenes`);
  console.log("");
}

export async function scaffoldCommand(options: ScaffoldOptions): Promise<void> {
  const { targetDir, dryRun, verbose, pm } = options;

  const blocking = await checkTargetDir(targetDir, options.force);
  if (blocking.length > 0 && options.force && verbose) {
    console.log(`Proceeding with --force. Existing files preserved: ${blocking.join(", ")}`);
  }

  const plan = generateScaffoldPlan(options);

  if (dryRun) {
    console.log("Dry run - would create:");
    console.log("");
    for (const folder of plan.folders) {
      console.log(`  mkdir ${relative(process.cwd(), folder)}/`);
    }
    for (const file of plan.files) {
      console.log(`  write ${relative(process.cwd(), file.path)}`);
    }
    if (plan.gitInit) {
      console.log("  git init");
    }
    if (plan.gitignoreEntries.length > 0) {
      console.log("  .gitignore entries:");
      for (const entry of plan.gitignoreEntries) {
        console.log(`    ${entry}`);
      }
    }
    console.log("");
    return;
  }

  await executePlan(plan, options);

  if (options.skipInstall === true) {
    printNextSteps(targetDir, pm);
    return;
  }

  await installDependencies(targetDir, pm, verbose);
  await runDoctor(verbose);
  printNextSteps(targetDir, pm);
}

export function createScaffoldCommand(): Command {
  const cmd = new Command("create-cinecode")
    .description("Create a new Cinecode project")
    .version(CREATE_CINECODE_VERSION)
    .argument("<directory>", "Target directory")
    .option("--ts", "Use TypeScript (skips the language prompt)", false)
    .option("--js", "Use JavaScript (skips the language prompt)", false)
    .option("--fps <number>", "Frames per second", "30")
    .option("--resolution <preset|WxH>", "Resolution preset or WxH", "1920x1080")
    .option("--no-git", "Skip git initialization")
    .option("--skip-install", "Skip dependency installation", false)
    .option("-f, --force", "Proceed even if directory is not empty", false)
    .option("--dry-run", "Print plan without writing files", false)
    .option("-v, --verbose", "Verbose output", false)
    .action(
      async (
        directory: string,
        opts: {
          ts?: boolean;
          js?: boolean;
          fps?: string;
          resolution?: string;
          git?: boolean;
          force?: boolean;
          dryRun?: boolean;
          verbose?: boolean;
          skipInstall?: boolean;
        },
      ) => {
        const targetDir = resolve(directory);

        let language: Language | undefined;
        if (opts.ts) language = "typescript";
        if (opts.js) language = "javascript";

        if (!language) {
          language = await selectLanguage();
        }

        const fpsInput = opts.fps ?? "30";
        const fps = parseInt(fpsInput, 10);
        if (isNaN(fps) || fps < 1 || fps > 120) {
          console.error("FPS must be a number between 1 and 120");
          process.exit(1);
        }

        const resolution = opts.resolution ?? "1920x1080";
        const resMatch = resolution.match(/^(\d+)x(\d+)$/);
        if (!resMatch) {
          console.error('Resolution must be in format "WIDTHxHEIGHT" (e.g., 1920x1080)');
          process.exit(1);
        }

        const pm = detectPackageManager();

        await scaffoldCommand({
          targetDir,
          language,
          fps,
          resolution,
          noGit: opts.git === false,
          force: opts.force ?? false,
          dryRun: opts.dryRun ?? false,
          verbose: opts.verbose ?? false,
          skipInstall: opts.skipInstall ?? false,
          pm,
        });
      },
    );

  return cmd;
}

