import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError, type ErrorLocation } from "../errors/index.js";
import {
  RESOLUTION_DIMENSIONS,
  validateConfigWithZod,
  validateNormalizedConfigWithZod,
  type ZodValidationIssue,
  type ZodValidationResult,
} from "./zod-schema.js";

const RESERVED_NAMES = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);
const INVALID_CHARS = /[<>:"|?*]/;
const TRAILING_DOT_OR_SPACE = /[. ]+$/;
const CINEMATIC_FPS = new Set([23.976, 29.97, 59.94]);

/** Keys removed because they had no implemented effect, with the replacement. */
export const REMOVED_CONFIG_KEYS: Readonly<Record<string, string>> = {
  name: "Removed; project identity is not configurable.",
  "project.name": "Removed; project identity is not configurable.",
  "video.title": "Removed; composition names come from timeline and scene entries.",
  "video.description": "Removed; output metadata is not configurable in this release.",
  "video.author": "Removed; output metadata is not configurable in this release.",
  "video.version": "Removed; output metadata is not configurable in this release.",
  "video.tags": "Removed; output metadata is not configurable in this release.",
  "video.license": "Removed; output metadata is not configurable in this release.",
  "video.aspectRatio": "Removed; aspect comes from video.width/video.height or render.platformPreset.",
  "video.pixelAspectRatio": "Removed; pixel aspect is always 1.",
  "video.colorSpace": "Removed; use render.colorManagement.",
  "render.background": "Removed; use video.background.",
  "render.enforceAspectRatio": "Removed; use render.platformPreset or explicit video.width/video.height.",
  "render.variants": "Removed; run `cinecode multi-res` for per-variant renders.",
  "dev.historyDepth": "Removed; the canvas editor owns its history depth.",
  logLevel: "Removed; use the CLI --verbose flag.",
  "audio.normalize": "Removed; apply audio processing in the timeline mixer.",
  "audio.limiter": "Removed; apply audio processing in the timeline mixer.",
  "audio.sidechains": "Removed; apply audio processing in the timeline mixer.",
  security: "Removed; plugin verification is controlled by the marketplace client.",
  telemetry: "Removed; use `cinecode telemetry`.",
  pluginPermissions: "Removed; sandbox permissions are configured per plugin.",
};

const SUPPORTED_KEYS_HINT = "Supported keys are listed in docs/config-reference.md.";

export interface ValidationResult {
  readonly errors: CinecodeError[];
  readonly warnings: CinecodeError[];
}

function schemaError(issue: ZodValidationIssue, configPath: string | undefined): CinecodeError {
  if (issue.code === "unrecognized_keys") {
    const key = issue.path ? `${issue.path}.${issue.keys?.[0]}` : issue.keys?.[0];
    return createError(
      ErrorCode.CC1002,
      { key: key ?? "config", suggestion: REMOVED_CONFIG_KEYS[key ?? ""] ?? SUPPORTED_KEYS_HINT },
      { location: { file: configPath }, cause: issue },
    );
  }
  const received = issue.received === undefined ? "" : JSON.stringify(issue.received);
  const reason = issue.expected ? `${issue.message}. Expected ${issue.expected}.` : issue.message;
  return createError(
    ErrorCode.CC1003,
    { key: issue.path || "config", path: received, reason },
    { location: { file: configPath }, cause: issue },
  );
}

function schemaErrors(result: ZodValidationResult, configPath?: string): CinecodeError[] {
  const errors: CinecodeError[] = [];
  for (const issue of result.errors) {
    const keys = issue.code === "unrecognized_keys" ? issue.keys ?? [] : [undefined];
    for (const key of keys) errors.push(schemaError({ ...issue, keys: key ? [key] : undefined }, configPath));
  }
  return errors;
}

/** Validates the document a user writes. Used by load, validate and the helper. */
export function validateAuthoringConfig(raw: unknown, configPath?: string): ValidationResult {
  return { errors: schemaErrors(validateConfigWithZod(raw), configPath), warnings: [] };
}

/** Validates the normalized document consumers receive. */
export function validateNormalizedConfig(config: unknown, configPath?: string): ValidationResult {
  return { errors: schemaErrors(validateNormalizedConfigWithZod(config), configPath), warnings: [] };
}

function findConfigLocation(configPath: string, keyPath: string): ErrorLocation {
  try {
    const content = readFileSync(configPath, "utf-8");
    const lines = content.split("\n");
    const searchKey = keyPath.split(".").pop() ?? keyPath;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const idx = line.indexOf(searchKey);
      if (idx !== -1 && (line.trimStart().startsWith(searchKey) || line.includes(`"${searchKey}"`) || line.includes(`'${searchKey}'`))) {
        return { file: configPath, line: i + 1, column: idx + 1 };
      }
    }
  } catch {
    return { file: configPath };
  }
  return { file: configPath };
}

function validatePath(key: string, path: string, configPath: string, kind: "source" | "output" = "output"): CinecodeError[] {
  const errors: CinecodeError[] = [];

  if (INVALID_CHARS.test(path)) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "contains invalid characters <>:\"|?*" }, { location: { file: configPath } }));
  }

  const parts = path.split(/[/\\]/);
  for (const part of parts) {
    if (part === "." || part === "..") continue;
    if (RESERVED_NAMES.has(part.toUpperCase())) {
      errors.push(createError(ErrorCode.CC1003, { key, path, reason: `contains reserved Windows name: ${part}` }, { location: { file: configPath } }));
    }
    if (TRAILING_DOT_OR_SPACE.test(part)) {
      errors.push(createError(ErrorCode.CC1003, { key, path, reason: "has trailing dots or spaces" }, { location: { file: configPath } }));
    }
  }

  if (resolve(path) === resolve(".")) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "cannot be project root" }, { location: { file: configPath } }));
  }
  if (kind !== "source" && resolve(path) === resolve("src")) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "cannot be src directory" }, { location: { file: configPath } }));
  }

  return errors;
}

/** The one validation entry point used by validate, check and doctor. */
export function validateConfig(config: CinecodeConfig, configPath: string): ValidationResult {
  const { errors } = validateNormalizedConfig(config, configPath);
  const warnings: CinecodeError[] = [];

  if (config.schemaVersion === 1) {
    warnings.push(createError(ErrorCode.CC1004, { version: "1", expected: "2" }, { location: findConfigLocation(configPath, "schemaVersion"), fixHint: "Schema v2 adds project/video/images/dev blocks; v1 still works.", severity: "warning" }));
  }

  errors.push(...validatePath("sourceDir", config.sourceDir, configPath, "source"));

  const dirs = [config.sourceDir, config.outputDir, config.cacheDir];
  if (new Set(dirs.map((dir) => resolve(dir))).size !== dirs.length) {
    errors.push(createError(ErrorCode.CC1003, { key: "sourceDir/outputDir/cacheDir", path: dirs.join(", "), reason: "all three directories must be different" }, { location: { file: configPath } }));
  }

  for (const [key, value] of [["outputDir", config.outputDir], ["cacheDir", config.cacheDir]] as const) {
    errors.push(...validatePath(key, value, configPath));
    if (!resolve(value).startsWith(resolve(".") + sep)) {
      warnings.push(createError(ErrorCode.CC1003, { key, path: value, reason: "relative paths recommended for portability" }, { location: findConfigLocation(configPath, key), severity: "warning" }));
    }
  }

  return { errors, warnings };
}

export function resolveResolution(presetOrValue: string): { width: number; height: number } {
  const preset = RESOLUTION_DIMENSIONS[presetOrValue as keyof typeof RESOLUTION_DIMENSIONS];
  if (preset) return { width: preset.width, height: preset.height };
  const match = presetOrValue.match(/^(\d+)x(\d+)$/i);
  if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  return { width: 1920, height: 1080 };
}

export function resolveFps(value: number): number {
  if (CINEMATIC_FPS.has(value)) return value;
  if (Number.isInteger(value) && value >= 1 && value <= 120) return value;
  return 30;
}
