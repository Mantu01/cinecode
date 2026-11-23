import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import prompts from "prompts";
import { createError, ErrorCode } from "../../errors/index.js";
import { CancellationSignal } from "../shared/exit-codes.js";
import { FRAMEWORK_RANGE } from "../../contracts.js";
import { RESOLUTION_DIMENSIONS } from "../../config/zod-schema.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";

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
    void 0;
  }

  const localDistCli = resolve(__dirname, "../../../../create-cinecode/dist/esm/cli.js");
  if (existsSync(localDistCli)) {
    return { cmd: process.execPath, baseArgs: [localDistCli] };
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return { cmd: npx, baseArgs: ["--yes", `create-cinecode@${FRAMEWORK_RANGE}`] };
}

import { CONFIG_FILENAMES } from "../../config/project.js";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { validateConfig } from "../../config/validator.js";
import { containsPath } from "../../config/roots.js";

function findAncestorConfig(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILENAMES) {
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
    void 0;
  }
  return blocking;
}

const PACKAGE_NAME_RULE = "lowercase letters, digits, and single hyphens; must start with a letter or digit and be at most 214 characters";

/** Lowercase, spaces and underscores become hyphens, other invalid runs are removed. */
export function slugifyPackageName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{0,213}$/.test(slug)) {
    throw new UsageError(`Invalid project name "${value}": expected ${PACKAGE_NAME_RULE}.`);
  }
  return slug;
}

const RESOLUTION_PRESETS: Record<string, string> = Object.fromEntries(
  Object.entries(RESOLUTION_DIMENSIONS).map(([id, size]) => [id, `${size.width}x${size.height}`]),
);

function resolveResolution(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const preset = RESOLUTION_PRESETS[value.toLowerCase()];
  if (preset) return preset;
  if (/^\d+x\d+$/.test(value)) return value;
  throw new UsageError(`Invalid resolution "${value}": expected WIDTHxHEIGHT or one of ${Object.keys(RESOLUTION_PRESETS).join(", ")}.`);
}

export async function createCommand(directory?: string, opts: {
  ts?: boolean;
  js?: boolean;
  yes?: boolean;
  name?: string;
  template?: string;
  fps?: number | string;
  resolution?: string;
  noGit?: boolean;
  localLink?: boolean;
  skipInstall?: boolean;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
} = {}): Promise<void> {
  if (opts.ts && opts.js) {
    throw new UsageError("Conflicting flags: --ts and --js cannot be used together.");
  }

  const projectName = opts.name ? slugifyPackageName(opts.name) : undefined;
  const resolution = resolveResolution(opts.resolution);
  if (opts.template === "javascript" && opts.ts) {
    throw new UsageError("Conflicting flags: --ts and template \"javascript\" cannot be used together.");
  }
  if (opts.template !== undefined && opts.template !== "javascript" && opts.js) {
    throw new UsageError(`Conflicting flags: --js and template "${opts.template}" cannot be used together.`);
  }
  let targetDir = directory;
  let useJs = opts.js === true || opts.template === "javascript";
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
    if (!opts.ts && !opts.js && !opts.template) {
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
  const noGit = opts.noGit === true;

  if (useJs) args.push("--js");
  else args.push("--ts");
  if (projectName) args.push("--name", projectName);
  if (opts.template) args.push("--template", opts.template);
  if (opts.fps) args.push("--fps", String(opts.fps));
  if (resolution) args.push("--resolution", resolution);
  if (noGit) args.push("--no-git");
  if (opts.localLink) args.push("--local-link");
  if (skipInstall) args.push("--skip-install");
  if (opts.force) args.push("-f");
  if (opts.dryRun) args.push("--dry-run");
  if (opts.verbose) args.push("-v");

  const captureStdout = opts.dryRun === true || runReport.isMachine();
  const result = spawnSync(runner.cmd, args, {
    stdio: ["ignore", captureStdout ? "pipe" : "inherit", "inherit"],
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) {
    throw createError(ErrorCode.CC7004, { reason: `create-cinecode could not start: ${result.error.message}` }, { cause: result.error });
  }
  if (result.status !== 0) {
    throw createError(ErrorCode.CC7004, { reason: `create-cinecode exited with ${result.status ?? "no status"}` });
  }
  const scaffoldOutput = captureStdout ? String(result.stdout ?? "") : "";
  const plannedFiles = opts.dryRun
    ? scaffoldOutput.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("write ")).map((line) => line.slice(6).trim())
    : [];
  if (opts.dryRun && !runReport.isMachine()) process.stdout.write(scaffoldOutput);
  if (!opts.dryRun) runReport.artifact({ kind: "project", path: target, units: 1, unit: "directory" });

  const verification = await verifyScaffold(target, !opts.dryRun, noGit);
  runReport.result({
    directory: target,
    created: opts.dryRun ? undefined : target,
    name: projectName,
    template: opts.template,
    dryRun: opts.dryRun === true,
    files: opts.dryRun ? plannedFiles : undefined,
    ...verification,
  });
}

async function verifyScaffold(projectDir: string, haveFiles: boolean, noGit: boolean): Promise<{
  configValid: boolean;
  manifestValid: boolean;
  entryInsideProject: boolean;
  sourceDirExists: boolean;
  mediaDirExists: boolean;
  gitignoreExists: boolean;
  gitWarning: boolean;
  verificationErrors: string[];
}> {
  let configValid = false;
  let manifestValid = false;
  let entryInsideProject = false;
  let sourceDirExists = false;
  let mediaDirExists = false;
  let gitignoreExists = false;
  let gitWarning = false;
  const verificationErrors: string[] = [];

  if (haveFiles) {
    const ext = existsSync(join(projectDir, "cinecode.config.js")) ? "js" : "ts";
    const configPath = join(projectDir, `cinecode.config.${ext}`);
    const manifestPath = join(projectDir, `main.${ext}`);
    let dependenciesInstalled = false;
    try {
      createRequire(join(projectDir, "package.json")).resolve("cinecode/package.json");
      dependenciesInstalled = true;
    } catch {
      verificationErrors.push("cinecode is not installed in the project; config and manifest were checked structurally only. Run the install step to validate them fully.");
    }
    try {
      if (!dependenciesInstalled) {
        configValid = existsSync(configPath) && readFileSync(configPath, "utf-8").includes("defineConfig");
        manifestValid = existsSync(manifestPath) && readFileSync(manifestPath, "utf-8").includes("defineMain");
        entryInsideProject = /entry:\s*"\.\//.test(existsSync(configPath) ? readFileSync(configPath, "utf-8") : "");
        sourceDirExists = existsSync(join(projectDir, "src"));
        mediaDirExists = existsSync(join(projectDir, "media"));
        gitignoreExists = existsSync(join(projectDir, ".gitignore"));
        gitWarning = !noGit && !existsSync(join(projectDir, ".git"));
        return { configValid, manifestValid, entryInsideProject, sourceDirExists, mediaDirExists, gitignoreExists, gitWarning, verificationErrors };
      }
      const resolution = await createProjectResolver({ root: projectDir, requireSelection: false }).resolve();
      const validation = validateConfig(resolution.config, resolution.configPath, resolution.root);
      configValid = validation.errors.length === 0;
      verificationErrors.push(...validation.errors.map((issue) => `${resolution.configPath}: ${issue.message}`));
      manifestValid = resolution.manifest?.validation?.valid ?? false;
      for (const issue of resolution.manifest?.validation?.errors ?? []) {
        verificationErrors.push(`${resolution.manifestPath}: ${issue.message}`);
      }
      const entry = resolution.config.project?.entry ?? "./main.ts";
      entryInsideProject = containsPath(resolution.root, resolve(resolution.root, entry));
      sourceDirExists = existsSync(resolution.context.roots.source);
      mediaDirExists = existsSync(resolution.context.roots.media);
      gitignoreExists = existsSync(join(projectDir, ".gitignore"));
      gitWarning = !noGit && !existsSync(join(projectDir, ".git"));
    } catch (error) {
      verificationErrors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    gitWarning = true;
  }

  return { configValid, manifestValid, entryInsideProject, sourceDirExists, mediaDirExists, gitignoreExists, gitWarning, verificationErrors };
}

