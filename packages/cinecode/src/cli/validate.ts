import { Command } from "commander";
import { resolve } from "node:path";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { loadConfig } from "../config/schema.js";
import { resolveProjectLocation } from "../config/project.js";
import { validateConfig } from "../config/validator.js";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { createError, ErrorCode, type CinecodeError, formatError } from "../errors/index.js";
import { createMediaResolver } from "../media/resolver.js";
import { mediaIgnore, printProjectContext } from "./shared.js";
import { createMediaCache } from "../media/cache.js";
import { loadComposition } from "./still.js";
import { allClips } from "../core/types/tracks.js";
import { runReport } from "./run-report.js";

export interface ValidateOptions {
  config?: string;
  root?: string;
  strict?: boolean;
  json?: boolean;
  fix?: boolean;
}

async function checkCompositionDeterminism(compositions: Composition[], file: string): Promise<CinecodeError[]> {
  const errors: CinecodeError[] = [];
  const nonDeterministicFunctions = ["Date.now", "Math.random", "performance.now"];

  function checkValue(value: unknown, path: string): void {
    if (typeof value === "function") {
      const fnStr = value.toString();
      for (const ndf of nonDeterministicFunctions) {
        if (fnStr.includes(ndf)) {
          errors.push(createError(ErrorCode.CC3005, { context: path, function: ndf }, { location: { file }, fixHint: `Replace ${ndf} with deterministic alternative` }));
        }
      }
    } else if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((v, i) => checkValue(v, `${path}[${i}]`));
      } else {
        for (const [k, v] of Object.entries(value)) {
          checkValue(v, `${path}.${k}`);
        }
      }
    }
  }

  for (const comp of compositions) {
    checkValue(comp, `composition.${comp.name}`);
  }

  return errors;
}

async function checkMediaFiles(config: CinecodeConfig, projectRoot: string): Promise<CinecodeError[]> {
  const errors: CinecodeError[] = [];
  const cache = createMediaCache(resolve(projectRoot, config.cacheDir));
  await cache.initialize();
  const resolver = createMediaResolver({ sourceDir: resolve(projectRoot, config.sourceDir), cache, cloudMedia: config.cloudMedia ?? [], ignore: mediaIgnore(config) });
  await resolver.initialize();

  const media = await resolver.listMedia();
  for (const m of media) {
    try {
      await resolver.resolve(m.name);
    } catch (e) {
      errors.push(createError(ErrorCode.CC2003, { path: m.path, reason: e instanceof Error ? e.message : "Unknown error" }, { location: { file: m.path } }));
    }
  }

  return errors;
}

async function checkFonts(config: CinecodeConfig): Promise<CinecodeError[]> {
  const errors: CinecodeError[] = [];

  if (config.fonts) {
    for (const font of config.fonts) {
      try {
        await import(font.src);
      } catch {
        errors.push(createError(ErrorCode.CC3006, { font: font.family, text: "font file" }, { fixHint: `Verify font path: ${font.src}` }));
      }
    }
  }

  return errors;
}

async function checkProps(compositions: Composition[]): Promise<CinecodeError[]> {
  const errors: CinecodeError[] = [];

  for (const comp of compositions) {
    const clips = allClips(comp.rootTimeline);
    for (const clip of clips) {
      if (clip.type === "component" && clip.props) {
        for (const [key, prop] of Object.entries(clip.props)) {
          if (prop === undefined || prop === null) {
            errors.push(createError(ErrorCode.CC3005, { context: `prop.${key}`, function: "missing type" }, { fixHint: `Add type to prop '${key}'` }));
          }
        }
      }
    }
  }

  return errors;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const location = resolveProjectLocation({ root: options.root, config: options.config });
  const projectRoot = location.root;
  const resolvedConfigPath = location.configPath;

  printProjectContext(location, (options as { verbose?: boolean }).verbose === true);
  const config = await loadConfig(resolvedConfigPath);
  const validation = validateConfig(config, resolvedConfigPath);
  runReport.setProject({ root: projectRoot, config: resolvedConfigPath, source: location.source });

  const compositions: Composition[] = await loadComposition(resolvedConfigPath);

  const determinismErrors = await checkCompositionDeterminism(compositions, resolvedConfigPath);
  const mediaErrors = await checkMediaFiles(config, projectRoot);
  const fontErrors = await checkFonts(config);
  const propErrors = await checkProps(compositions);

  const allErrors = [...validation.errors, ...determinismErrors, ...mediaErrors, ...fontErrors, ...propErrors];
  const allWarnings = [...validation.warnings];

  if (options.fix) {
    const added = await ensureGitignoreEntries({
      sourceDir: config.sourceDir,
      outputDir: config.outputDir ?? "output",
      cacheDir: config.cacheDir ?? ".cinecode/cache",
      projectRoot,
      enabled: config.gitignore ?? true,
    });
    console.log(added.length > 0 ? `Fixed: added ${added.join(", ")} to .gitignore` : "No .gitignore changes needed");
  }

  const output = {
    valid: allErrors.length === 0,
    errors: allErrors.map(e => ({
      code: e.code,
      severity: e.severity,
      message: e.message,
      fixHint: e.fixHint,
      location: e.location,
    })),
    warnings: allWarnings.map(w => ({
      code: w.code,
      severity: w.severity,
      message: w.message,
      fixHint: w.fixHint,
      location: w.location,
    })),
  };
  runReport.result(output);
  for (const warning of allWarnings) runReport.warn(warning.code, warning.message, warning.location?.file);

  if (!runReport.isMachine()) {
    for (const error of allErrors) {
      console.error(formatError(error, false, true));
    }
    for (const warning of allWarnings) {
      console.warn(formatError(warning, false, true));
    }

    if (allErrors.length === 0 && allWarnings.length === 0) {
      console.log("Validation passed");
    } else if (allErrors.length === 0) {
      console.log(`${allWarnings.length} warning(s)`);
    }
  }

  if (allErrors.length > 0 || (options.strict && allWarnings.length > 0)) {
    const count = allErrors.length + (options.strict ? allWarnings.length : 0);
    throw createError(ErrorCode.CC1013, { count }, { location: { file: resolvedConfigPath } });
  }
}

export function createValidateCommand(): Command {
  const cmd = new Command("validate")
    .description("Validate configuration, compositions, media, and fonts")
    .option("--strict", "Treat warnings as errors", false)
    .option("--fix", "Auto-fix issues (currently: .gitignore)", false)
    .action(async (options: ValidateOptions, command: Command) => {
      await validateCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}