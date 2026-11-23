import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateConfig } from "../../config/validator.js";
import { createError, ErrorCode, isCinecodeError } from "../../errors/index.js";
import { referenceWarnings } from "../../manifest/references.js";
import { allClips } from "../../core/types/tracks.js";
import { validateKeyframes } from "../../core/keyframes/index.js";
import { checkMissingGlyphs } from "../../renderer/text/engine.js";
import { registerProjectFonts } from "../../renderer/text/fonts.js";
import { scanAuthoredModule } from "../../manifest/determinism.js";
import { runRuntimeGate, runCapabilityGate, runResourcesGate } from "./validation-sys-gates.js";
import type { Composition } from "../../core/types/index.js";
import type { CompositionValidation } from "../../core/validation/composition.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";
import type { ValidationGate, ValidationIssue } from "./validation-types.js";

export interface GateResult {
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

async function runConfigGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const validation = validateConfig(resolution.config, resolution.configPath, resolution.root);

  for (const err of validation.errors) {
    errors.push({
      code: err.code,
      severity: "error",
      gate: "config",
      file: err.location?.file ?? resolution.configPath,
      line: err.location?.line,
      column: err.location?.column,
      message: err.message,
      fix: err.fixHint ?? "Fix configuration schema in cinecode.config.ts",
      fixHint: err.fixHint ?? "Fix configuration schema in cinecode.config.ts",
    });
  }
  for (const warn of validation.warnings) {
    warnings.push({
      code: warn.code,
      severity: "warning",
      gate: "config",
      file: warn.location?.file ?? resolution.configPath,
      line: warn.location?.line,
      column: warn.location?.column,
      message: warn.message,
      fix: warn.fixHint ?? "Update configuration property",
      fixHint: warn.fixHint ?? "Update configuration property",
    });
  }
  return { errors, warnings };
}

async function runManifestGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const err of resolution.validation?.errors ?? []) {
    errors.push({
      code: err.code,
      severity: "error",
      gate: "manifest",
      file: err.location?.file ?? resolution.manifestPath,
      line: err.location?.line,
      column: err.location?.column,
      message: err.message,
      fix: err.fixHint ?? "Fix manifest declaration",
      fixHint: err.fixHint ?? "Fix manifest declaration",
    });
  }
  for (const warn of resolution.validation?.warnings ?? []) {
    warnings.push({
      code: warn.code,
      severity: "warning",
      gate: "manifest",
      file: warn.location?.file ?? resolution.manifestPath,
      line: warn.location?.line,
      column: warn.location?.column,
      message: warn.message,
      fix: warn.fixHint ?? "Check manifest reference",
      fixHint: warn.fixHint ?? "Check manifest reference",
    });
  }

  if (!resolution.validation && resolution.manifest) {
    for (const warn of referenceWarnings(resolution.manifest.manifest)) {
      warnings.push({
        code: warn.code,
        severity: "warning",
        gate: "manifest",
        file: warn.location?.file ?? resolution.manifestPath,
        line: warn.location?.line,
        column: warn.location?.column,
        message: warn.message,
        fix: warn.fixHint ?? "Check reference in manifest",
        fixHint: warn.fixHint ?? "Check reference in manifest",
      });
    }
  }

  return { errors, warnings };
}

async function runModulesGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  let compositions: readonly Composition[] = [];
  try {
    compositions = await resolution.all();
  } catch (error) {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC1010, { path: resolution.configPath, reason: error instanceof Error ? error.message : String(error) });
    errors.push({
      code: coded.code,
      severity: "error",
      gate: "modules",
      file: coded.location?.file ?? resolution.configPath,
      line: coded.location?.line,
      column: coded.location?.column,
      message: coded.message,
      fix: coded.fixHint ?? "Ensure module exports valid defineScene or defineTimeline",
      fixHint: coded.fixHint ?? "Ensure module exports valid defineScene or defineTimeline",
    });
    return { errors, warnings };
  }

  let timelineResults: readonly CompositionValidation[] = [];
  try {
    timelineResults = await resolution.validateCompositions();
  } catch (error) {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC1010, { path: resolution.configPath, reason: error instanceof Error ? error.message : String(error) });
    errors.push({
      code: coded.code,
      severity: "error",
      gate: "modules",
      file: coded.location?.file ?? resolution.configPath,
      line: coded.location?.line,
      column: coded.location?.column,
      message: coded.message,
      fix: coded.fixHint,
      fixHint: coded.fixHint,
    });
    return { errors, warnings };
  }

  for (const result of timelineResults) {
    for (const issue of result.errors) {
      errors.push({
        code: issue.code,
        severity: "error",
        gate: "modules",
        file: issue.position?.file ?? resolution.configPath,
        line: issue.position?.line,
        column: issue.position?.column,
        message: issue.message,
        fix: issue.hint ?? "Correct clip timing or placement",
        fixHint: issue.hint ?? "Correct clip timing or placement",
      });
    }
    for (const issue of result.warnings) {
      warnings.push({
        code: issue.code,
        severity: "warning",
        gate: "modules",
        file: issue.position?.file ?? resolution.configPath,
        line: issue.position?.line,
        column: issue.position?.column,
        message: issue.message,
        fix: issue.hint ?? "Review clip timing or placement",
        fixHint: issue.hint ?? "Review clip timing or placement",
      });
    }
  }

  for (const composition of compositions) {
    for (const clip of allClips(composition.rootTimeline)) {
      const kfProps = (clip as { keyframes?: readonly (readonly [string, readonly (readonly [number, unknown])[]])[] }).keyframes;
      if (Array.isArray(kfProps)) {
        for (const [property, tuples] of kfProps) {
          const engineKeyframes = tuples.map((t: readonly [number, unknown]) => ({ atFrames: t[0], value: t[1] }));
          try {
            validateKeyframes(property, engineKeyframes, { file: resolution.configPath, line: 0, column: 0 });
          } catch (error) {
            errors.push({
              code: ErrorCode.CC3004,
              severity: "error",
              gate: "modules",
              file: resolution.configPath,
              message: error instanceof Error ? error.message : String(error),
              fix: "Sort keyframes by time and remove duplicate times",
              fixHint: "Sort keyframes by time and remove duplicate times",
            });
          }
        }
      }
      if (clip.type === "text") {
        const missing = checkMissingGlyphs(clip.content, {
          fontFamily: clip.fontFamily ?? "sans-serif",
          fontWeight: clip.fontWeight ?? "normal",
          fontStyle: clip.fontStyle ?? "normal",
          fontSize: clip.fontSize,
          lineHeight: clip.lineHeight ?? 1.2,
          letterSpacing: clip.letterSpacing ?? 0,
          align: clip.align ?? "left",
        });
        if (missing.length > 0) {
          warnings.push({
            code: ErrorCode.CC3006,
            severity: "warning",
            gate: "modules",
            message: `Text clip may be missing glyphs: ${missing.join(", ")}`,
            file: resolution.configPath,
            fix: "Register a font covering these glyphs",
            fixHint: "Register a font covering these glyphs",
          });
        }
      }
    }
  }

  return { errors, warnings };
}

async function runMediaGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  try {
    const media = await resolution.media();
    const manifest = resolution.manifest?.manifest;
    if (manifest) {
      for (const audio of manifest.audio ?? []) {
        if (audio.src) {
          try {
            await media.catalog.resolve(audio.src);
          } catch (error) {
            errors.push({
              code: ErrorCode.CC2001,
              severity: "error",
              gate: "media",
              file: audio.src,
              message: `Referenced audio asset not found: "${audio.src}". ${error instanceof Error ? error.message : ""}`.trim(),
              fix: "Ensure media file exists in media directory",
              fixHint: "Ensure media file exists in media directory",
            });
          }
        }
      }
    }

    for (const item of media.index.list()) {
      if (!item.exists) {
        errors.push({
          code: ErrorCode.CC2001,
          severity: "error",
          gate: "media",
          file: item.absolutePath,
          message: `Media file does not exist: ${item.absolutePath}`,
          fix: "Ensure the file exists in the media directory",
          fixHint: "Ensure the file exists in the media directory",
        });
        continue;
      }
      try {
        await media.catalog.resolve(item.name);
      } catch (error) {
        errors.push({
          code: ErrorCode.CC2003,
          severity: "error",
          gate: "media",
          file: item.absolutePath,
          message: `Media file unreadable: ${item.absolutePath}. ${error instanceof Error ? error.message : "unknown"}`,
          fix: "Ensure the file exists in the media directory and has supported format",
          fixHint: "Ensure the file exists in the media directory and has supported format",
        });
      }
    }
  } catch (error) {
    errors.push({
      code: ErrorCode.CC2003,
      severity: "error",
      gate: "media",
      message: `Media resolution error: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Configure a valid media directory in cinecode.config.ts",
      fixHint: "Configure a valid media directory in cinecode.config.ts",
    });
  }

  return { errors, warnings };
}

async function runFontsGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const fontResult = registerProjectFonts(resolution.config.fonts, {
    projectRoot: resolution.root,
    mediaDir: resolution.config.mediaDir ?? "media",
  });

  for (const font of fontResult.errors) {
    errors.push({
      code: font.code ?? ErrorCode.CC3006,
      severity: "error",
      gate: "fonts",
      file: font.path,
      message: font.message,
      fix: "Fix font path or provide supported font (.ttf, .otf, .ttc) in media directory",
      fixHint: "Fix font path or provide supported font (.ttf, .otf, .ttc) in media directory",
    });
  }
  for (const font of fontResult.warnings) {
    warnings.push({
      code: font.code ?? ErrorCode.CC3006,
      severity: "warning",
      gate: "fonts",
      file: font.path,
      message: font.message,
      fix: "Remove duplicate font family definition",
      fixHint: "Remove duplicate font family definition",
    });
  }

  return { errors, warnings };
}

async function runDeterminismGate(resolution: ProjectResolution): Promise<GateResult> {
  const errors: ValidationIssue[] = [];
  const targets = new Set<string>();
  if (resolution.configPath && existsSync(resolution.configPath)) targets.add(resolution.configPath);
  if (resolution.manifest?.entryPath && existsSync(resolution.manifest.entryPath)) targets.add(resolution.manifest.entryPath);
  if (resolution.manifest?.manifest) {
    const entries = [
      ...(resolution.manifest.manifest.scenes ?? []),
      ...(resolution.manifest.manifest.timelines ?? []),
      ...(resolution.manifest.manifest.images ?? []),
      ...(resolution.manifest.manifest.audio ?? []),
    ];
    for (const entry of entries) {
      if (entry.file) {
        const full = resolve(resolution.manifest.rootDir, entry.file);
        if (existsSync(full)) targets.add(full);
      }
    }
  }

  for (const file of targets) {
    const fileErrors = scanAuthoredModule(file, resolution.root);
    for (const issue of fileErrors) {
      errors.push({
        code: issue.code,
        severity: "error",
        gate: "determinism",
        file: issue.location?.file ?? file,
        line: issue.location?.line,
        column: issue.location?.column,
        message: issue.message,
        fix: issue.fixHint ?? "Replace non-deterministic call with deterministic seed API",
        fixHint: issue.fixHint ?? "Replace non-deterministic call with deterministic seed API",
      });
    }
  }

  return { errors, warnings: [] };
}

export async function runSingleGate(gate: ValidationGate, resolution: ProjectResolution): Promise<GateResult> {
  switch (gate) {
    case "runtime":
      return runRuntimeGate();
    case "config":
      return runConfigGate(resolution);
    case "manifest":
      return runManifestGate(resolution);
    case "modules":
      return runModulesGate(resolution);
    case "media":
      return runMediaGate(resolution);
    case "fonts":
      return runFontsGate(resolution);
    case "determinism":
      return runDeterminismGate(resolution);
    case "capability":
      return runCapabilityGate(resolution);
    case "resources":
      return runResourcesGate(resolution);
  }
}
