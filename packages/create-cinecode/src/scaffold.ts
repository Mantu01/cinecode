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

export const FRAMEWORK_RANGE = "^1.0.0";
const TEMPLATES_DIR = resolve(__dirname, "templates");

export function availableTemplates(): string[] {
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Same rule as the CLI: lowercase, separators become hyphens, invalid runs removed. */
export function slugifyPackageName(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{0,213}$/.test(slug)) {
    throw new Error(`Invalid project name "${value}": expected lowercase letters, digits, and single hyphens.`);
  }
  return slug;
}

export const CREATE_CINECODE_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
).version;

export interface ScaffoldOptions {
  readonly targetDir: string;
  readonly language: Language;
  readonly name?: string;
  readonly template?: string;
  readonly fps: number;
  readonly resolution: string;
  readonly noGit: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly pm: PackageManager;
  readonly skipInstall?: boolean;
  readonly localLink?: boolean;
}

export interface FilePlan {
  readonly path: string;
  readonly content: string;
}

export interface ScaffoldPlan {
  readonly files: readonly FilePlan[];
  readonly gitignoreEntries: readonly string[];
  readonly gitInit: boolean;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function resolveTemplateDir(template: string | undefined, language: Language): string {
  const name = template ?? language;
  const dir = resolve(TEMPLATES_DIR, name);
  if (!existsSync(dir)) {
    throw new Error(`Unknown template "${name}". Available: ${availableTemplates().join(", ")}`);
  }
  return dir;
}

function listTemplateFiles(templateDir: string): string[] {
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

  walk(templateDir, "");
  return files;
}

export function resolveCinecodeDep(localLink?: boolean): string {
  if (localLink) {
    return "workspace:*";
  }
  return FRAMEWORK_RANGE;
}

function generateScaffoldPlan(options: ScaffoldOptions): ScaffoldPlan {
  const { targetDir, language, fps, resolution, noGit, localLink } = options;

  const isTypeScript = language === "typescript";
  const [width, height] = resolution.split("x").map(Number);
  const dep = resolveCinecodeDep(localLink);
  const templateDir = resolveTemplateDir(options.template, language);

  const vars = {
    FPS: String(fps),
    RESOLUTION: resolution,
    WIDTH: String(width),
    HEIGHT: String(height),
    EXT: isTypeScript ? "ts" : "js",
    CONFIG_EXT: isTypeScript ? "ts" : "js",
    LANGUAGE: language,
    CINECODE_DEP: dep,
    PROJECT_NAME: slugifyPackageName(options.name ?? basename(targetDir)),
    TYPECHECK_SCRIPT: "tsc --noEmit",
  };

  const files: FilePlan[] = [];
  for (const relPath of listTemplateFiles(templateDir)) {
    const content = readFileSync(resolve(templateDir, relPath), "utf-8");
    const rendered = content.includes("{{") ? renderTemplate(content, vars) : content;
    files.push({ path: resolve(targetDir, relPath), content: rendered });
  }

  if (!files.some((f) => f.path === resolve(targetDir, "output/.gitkeep"))) {
    files.push({ path: resolve(targetDir, "output/.gitkeep"), content: "" });
  }

  const gitignoreEntries = ["output", ".cinecode/cache"];

  const gitInit = !noGit && !existsSync(resolve(targetDir, ".git"));

  return { files, gitignoreEntries, gitInit };
}

const CONFIG_NAMES = [
  "cinecode.config.ts",
  "cinecode.config.js",
  "cinecode.config.mjs",
  "cinecode.config.cjs",
  "cinecode.json",
];

export function findAncestorConfig(startDir: string): string | null {
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

export function getBlockingFiles(targetDir: string): string[] {
  const blocking: string[] = [];
  if (!existsSync(targetDir)) {
    return blocking;
  }
  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      blocking.push(entry.name);
    }
  } catch {
    void 0;
  }
  return blocking;
}

async function checkTargetDir(targetDir: string, force: boolean): Promise<string[]> {
  const ancestorConfig = findAncestorConfig(targetDir);
  if (ancestorConfig) {
    throw new Error(
      `[CC1003] Cannot scaffold inside an existing Cinecode project: found config at ${ancestorConfig}. Scaffold in an isolated directory.`,
    );
  }

  const blocking = getBlockingFiles(targetDir);
  if (blocking.length > 0 && !force) {
    throw new Error(
      `[CC1003] Target directory is not empty. Blocking files: ${blocking.join(", ")}. Use --force to proceed.`,
    );
  }

  return blocking;
}

async function executePlan(plan: ScaffoldPlan, options: ScaffoldOptions): Promise<void> {
  const { targetDir, verbose } = options;

  for (const file of plan.files) {
    const relPath = relative(process.cwd(), file.path);
    if (verbose) console.log(`write ${relPath}`);
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf-8");
  }

  if (plan.gitInit) {
    if (verbose) console.log("git init");
    const { execSync } = await import("node:child_process");
    try {
      execSync("git init", { cwd: targetDir, stdio: "pipe" });
    } catch {
      console.error("Warning: git is not available; skipping repository initialization.");
    }
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
  const binary = process.platform === "win32" && !cmd.endsWith(".cmd") && !cmd.endsWith(".exe") ? `${cmd}.cmd` : cmd;
  const args = installCmd.slice(1);
  const result = spawnSync(binary, args, {
    cwd: targetDir,
    stdio: verbose ? "inherit" : "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const fullCmd = `${cmd} ${args.join(" ")}`;
    if (result.stderr) {
      console.error(result.stderr);
    }
    if (result.stdout && !verbose) {
      console.log(result.stdout);
    }
    throw new Error(
      `Dependency installation failed running '${fullCmd}' with exit code ${result.status ?? "unknown"}. ` +
        `Project files are intact. Retry with: cd ${targetDir} && ${fullCmd}`,
    );
  }
}

function printNextSteps(targetDir: string, pm: PackageManager): void {
  const dirName = basename(resolve(targetDir));
  const cdCmd = `cd ${dirName}`;
  const devCmd = getRunCommand(pm, "dev");
  const renderCmd = getRunCommand(pm, "render");

  console.log("");
  console.log("Project created successfully!");
  console.log("");
  console.log("Next steps:");
  console.log(`  ${cdCmd}`);
  console.log(`  ${devCmd}          Start the dev server`);
  console.log(`  ${renderCmd}       Render the default timeline`);
  console.log("");
}

async function verifyScaffold(targetDir: string, language: Language, verbose: boolean): Promise<void> {
  const ext = language === "typescript" ? "ts" : "js";
  const configPath = resolve(targetDir, `cinecode.config.${ext}`);
  const manifestPath = resolve(targetDir, `main.${ext}`);
  const pkgPath = resolve(targetDir, "package.json");

  if (!existsSync(configPath)) {
    throw new Error(`Scaffold verification failed: config file missing at ${configPath}`);
  }
  const configContent = readFileSync(configPath, "utf-8");
  if (!configContent.includes("defineConfig")) {
    throw new Error(`Scaffold verification failed: config file at ${configPath} does not define a valid Cinecode config`);
  }

  if (!existsSync(pkgPath)) {
    throw new Error(`Scaffold verification failed: package.json missing at ${pkgPath}`);
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Scaffold verification failed: package.json is invalid JSON`, { cause: err });
  }
  const deps = pkg.dependencies as Record<string, string> | undefined;
  if (!deps?.cinecode) {
    throw new Error(`Scaffold verification failed: package.json does not declare cinecode dependency`);
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`Scaffold verification failed: manifest file missing at ${manifestPath}`);
  }
  const manifestContent = readFileSync(manifestPath, "utf-8");
  if (!manifestContent.includes("defineMain")) {
    throw new Error(`Scaffold verification failed: manifest at ${manifestPath} does not export defineMain`);
  }

  const entryMatch = /entry:\s*"([^"]+)"/.exec(configContent);
  if (entryMatch) {
    const entryPath = resolve(targetDir, entryMatch[1]!);
    if (relative(targetDir, entryPath).startsWith("..")) {
      throw new Error(`Scaffold verification failed: manifest entry escapes the project: ${entryPath}`);
    }
  }

  const expectedSourceFiles = [
    `src/scenes/intro.${ext}`,
    `src/timelines/main.${ext}`,
    `src/components/title-card.${ext}`,
    "media/README.md",
    "output/.gitkeep",
    ".gitignore",
  ];
  for (const rel of expectedSourceFiles) {
    const full = resolve(targetDir, rel);
    if (!existsSync(full)) {
      throw new Error(`Scaffold verification failed: expected source file missing at ${full}`);
    }
  }

  if (verbose) {
    for (const rel of ["config", "manifest", "package.json", "entry", ...expectedSourceFiles]) {
      console.log(`  verified ${rel}`);
    }
    console.log("Scaffold post-verification passed: config, manifest, and project contract verified.");
  }
}

export async function scaffoldCommand(options: ScaffoldOptions): Promise<void> {
  const { targetDir, dryRun, verbose, pm, localLink } = options;

  const dep = resolveCinecodeDep(localLink);
  console.log(`Resolved dependency: cinecode@${dep}`);

  const blocking = await checkTargetDir(targetDir, options.force);
  if (blocking.length > 0 && options.force && verbose) {
    console.log(`Proceeding with --force. Existing files preserved: ${blocking.join(", ")}`);
  }

  const plan = generateScaffoldPlan(options);

  if (dryRun) {
    console.log("Dry run - would create:");
    console.log("");
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
  await verifyScaffold(targetDir, options.language, verbose);

  if (options.skipInstall === true) {
    printNextSteps(targetDir, pm);
    return;
  }

  await installDependencies(targetDir, pm, verbose);
  printNextSteps(targetDir, pm);
}

export function createScaffoldCommand(): Command {
  const cmd = new Command("create-cinecode")
    .description("Create a new Cinecode project")
    .version(CREATE_CINECODE_VERSION)
    .argument("<directory>", "Target directory")
    .option("--ts", "Use TypeScript (skips the language prompt)", false)
    .option("--js", "Use JavaScript (skips the language prompt)", false)
    .option("-n, --name <name>", "Project package name (slugified)")
    .option("-t, --template <name>", `Template directory (${availableTemplates().join(", ")})`)
    .option("--fps <number>", "Frames per second", "30")
    .option("--resolution <WxH>", "Resolution geometry, e.g. 1920x1080", "1920x1080")
    .option("--no-git", "Skip git initialization")
    .option("--local-link", "Use local workspace dependency for development", false)
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
          name?: string;
          template?: string;
          fps?: string;
          resolution?: string;
          git?: boolean;
          localLink?: boolean;
          force?: boolean;
          dryRun?: boolean;
          verbose?: boolean;
          skipInstall?: boolean;
        },
      ) => {
        const targetDir = resolve(directory);

        if (opts.ts && opts.js) {
          console.error("Conflicting flags: --ts and --js cannot be used together.");
          process.exitCode = 2;
          return;
        }
        let language: Language | undefined;
        if (opts.ts) language = "typescript";
        if (opts.js) language = "javascript";

        if (opts.template !== undefined) {
          if (!availableTemplates().includes(opts.template)) {
            console.error(`Unknown template "${opts.template}". Available: ${availableTemplates().join(", ")}`);
            process.exitCode = 2;
            return;
          }
          if (opts.template === "javascript" && opts.ts) {
            console.error("Conflicting flags: --ts and template \"javascript\" cannot be used together.");
            process.exitCode = 2;
            return;
          }
          if (opts.template !== "javascript" && opts.js) {
            console.error(`Conflicting flags: --js and template "${opts.template}" cannot be used together.`);
            process.exitCode = 2;
            return;
          }
          language = opts.template === "javascript" ? "javascript" : "typescript";
        }

        if (!language) {
          language = await selectLanguage();
        }

        let projectName: string | undefined;
        try {
          projectName = opts.name !== undefined ? slugifyPackageName(opts.name) : undefined;
        } catch (err) {
          console.error((err as Error).message);
          process.exitCode = 2;
          return;
        }

        const fpsInput = opts.fps ?? "30";
        const fps = parseInt(fpsInput, 10);
        if (isNaN(fps) || fps < 1 || fps > 240) {
          console.error("FPS must be a number between 1 and 240");
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
          name: projectName,
          template: opts.template,
          fps,
          resolution,
          noGit: opts.git === false,
          localLink: opts.localLink ?? false,
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

