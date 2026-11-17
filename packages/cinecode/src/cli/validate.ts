import { Command } from "commander";
import type { CinecodeConfig, Composition } from "../core/types/index.js";
import { validateConfig } from "../config/validator.js";
import { ensureGitignoreEntries } from "../config/gitignore.js";
import { createError, ErrorCode, type CinecodeError, formatError } from "../errors/index.js";
import { createProjectResolver, reportResolution, type MediaAccess } from "./project-resolver.js";
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

async function checkMediaFiles(access: MediaAccess): Promise<CinecodeError[]> {
  const errors: CinecodeError[] = [];
  for (const media of await access.catalog.listMedia()) {
    try {
      await access.catalog.resolve(media.name);
    } catch (error) {
      errors.push(createError(ErrorCode.CC2003, { path: media.path, reason: error instanceof Error ? error.message : "Unknown error" }, { location: { file: media.path } }));
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
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  reportResolution(resolution, (options as { verbose?: boolean }).verbose === true);
  const projectRoot = resolution.root;
  const resolvedConfigPath = resolution.configPath;
  const config: CinecodeConfig = resolution.config;
  const validation = validateConfig(config, resolvedConfigPath);
  const compositions = await resolver.all();

  const determinismErrors = await checkCompositionDeterminism([...compositions], resolvedConfigPath);
  const mediaErrors = await checkMediaFiles(await resolution.media());
  const fontErrors = await checkFonts(config);
  const propErrors = await checkProps([...compositions]);

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