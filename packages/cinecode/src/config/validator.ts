import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError, type ErrorLocation } from "../errors/index.js";
import {
  RESOLUTION_DIMENSIONS,
  validateConfigWithZod,
  validateNormalizedConfigWithZod,
  type ZodValidationIssue,
  type ZodValidationResult,
} from "./zod-schema.js";
import { authoredRoots, validateProjectRoots, validateRootFilenames } from "./roots.js";

const CINEMATIC_FPS = new Set([23.976, 29.97, 59.94]);

/** Keys removed because they had no implemented effect, with the replacement. */
export const REMOVED_CONFIG_KEYS: Readonly<Record<string, string>> = {
  name: "Removed; project identity is not configurable.",
  "project.name": "Removed; project identity is not configurable.",
  "video.title": "Removed; composition names come from timeline and scene entries.",
  "video.description": "Removed; output metadata is not configurable.",
  "video.author": "Removed; output metadata is not configurable.",
  "video.version": "Removed; output metadata is not configurable.",
  "video.tags": "Removed; output metadata is not configurable.",
  "video.license": "Removed; output metadata is not configurable.",
  "video.aspectRatio": "Removed; aspect comes from video.width/video.height or render.platformPreset.",
  "video.pixelAspectRatio": "Removed; pixel aspect is always 1.",
  "video.colorSpace": "Removed; use render.colorManagement.",
  "render.background": "Removed; use video.background.",
  "render.enforceAspectRatio": "Removed; use render.platformPreset or explicit video.width/video.height.",
  "render.variants": "Removed; use `cinecode render --variants` instead.",
  "dev.historyDepth": "Removed; editor state is not configurable.",
  "dev.metricsPort": "Removed; metrics are served on the dev port at /metrics.",
  logLevel: "Removed; use the CLI --verbose flag.",
  "audio.normalize": "Removed; apply audio processing in the timeline mixer.",
  "audio.limiter": "Removed; apply audio processing in the timeline mixer.",
  "audio.sidechains": "Removed; apply audio processing in the timeline mixer.",
  security: "Removed; plugin verification is controlled by local capabilities.",
  composition: "Removed; select a composition with --composition or render the file directly.",
  telemetry: "Removed; telemetry is not supported.",
  pluginPermissions: "Removed; sandbox permissions are configured per plugin.",
};

const SUPPORTED_KEYS_HINT = "Supported keys are listed in docs/config-reference.md.";

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev: number[] = [];
  for (let i = 0; i <= b.length; i++) prev[i] = i;
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(current[j]! + 1, prev[j + 1]! + 1, prev[j]! + cost);
    }
    prev.splice(0, prev.length, ...current);
  }
  return prev[b.length]!;
}

const KNOWN_CONFIG_KEYS: readonly string[] = [
  "$schema", "extends", "schemaVersion",
  "project", "project.entry", "project.sourceDir", "project.mediaDir", "project.outputDir", "project.cacheDir",
  "video", "video.width", "video.height", "video.fps", "video.defaultDuration", "video.background",
  "images", "images.defaultFormat", "images.quality", "images.scaleFactor",
  "dev", "dev.port", "dev.host", "dev.open", "dev.hmr",
  "render", "render.fps", "render.resolution", "render.format", "render.quality", "render.codec", "render.crf",
  "render.preset", "render.hardwareAcceleration", "render.concurrency", "render.chunkSize", "render.memoryBudgetMb",
  "render.alpha", "render.twoPass", "render.platformPreset", "render.bitrate", "render.colorManagement",
  "audio", "audio.sampleRate", "audio.channels", "audio.masterVolume",
  "binaries", "binaries.ffmpegPath", "binaries.ffprobePath",
  "allowCoLocatedMedia", "cloudMedia", "fonts", "concurrency", "overwrite", "gitignore",
  "plugins", "pluginPrecedence", "autoDiscoverPlugins", "ignorePatterns",
  "entry", "sourceDir", "mediaDir", "outputDir", "cacheDir", "width", "height", "fps", "background", "duration", "defaultDuration",
];

function suggestNearestKey(key: string): string | undefined {
  let best: string | undefined;
  let bestDist = 4;
  for (const candidate of KNOWN_CONFIG_KEYS) {
    const dist = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

export function assertNotCompositionExport(value: unknown, locationFile?: string): void {
  if (value !== null && typeof value === "object" && "rootTimeline" in value) {
    throw createError(
      ErrorCode.CC1002,
      {
        key: "rootTimeline",
        suggestion: "Exported object appears to be a composition with rootTimeline, not a Cinecode config. Move your composition into an entry file (e.g. main.ts) and export a valid Cinecode configuration from cinecode.config.ts.",
      },
      {
        location: locationFile ? { file: locationFile } : undefined,
        fixHint: "Define compositions in entry files (e.g. main.ts) with defineScene or defineTimeline, and use defineConfig in cinecode.config.ts.",
      },
    );
  }
}

export function assertNoConflictingAliases(raw: Record<string, unknown>, configPath?: string): void {
  const project = (raw.project as Record<string, unknown> | undefined) ?? {};
  const video = (raw.video as Record<string, unknown> | undefined) ?? {};
  const render = (raw.render as Record<string, unknown> | undefined) ?? {};

  const pairs: [string, unknown, string, unknown, () => void][] = [
    ["entry", raw.entry, "project.entry", project.entry, () => { delete raw.entry; }],
    ["sourceDir", raw.sourceDir, "project.sourceDir", project.sourceDir, () => { delete raw.sourceDir; }],
    ["mediaDir", raw.mediaDir, "project.mediaDir", project.mediaDir, () => { delete raw.mediaDir; }],
    ["outputDir", raw.outputDir, "project.outputDir", project.outputDir, () => { delete raw.outputDir; }],
    ["cacheDir", raw.cacheDir, "project.cacheDir", project.cacheDir, () => { delete raw.cacheDir; }],
    ["width", raw.width, "video.width", video.width, () => { delete raw.width; }],
    ["height", raw.height, "video.height", video.height, () => { delete raw.height; }],
    ["fps", raw.fps, "video.fps", video.fps, () => { delete raw.fps; }],
    ["fps", raw.fps, "render.fps", render.fps, () => { delete raw.fps; }],
    ["video.fps", video.fps, "render.fps", render.fps, () => { delete render.fps; }],
    ["background", raw.background, "video.background", video.background, () => { delete raw.background; }],
    ["render.background", render.background, "video.background", video.background, () => { delete render.background; }],
    ["duration", raw.duration, "video.defaultDuration", video.defaultDuration, () => { delete raw.duration; }],
    ["defaultDuration", raw.defaultDuration, "video.defaultDuration", video.defaultDuration, () => { delete raw.defaultDuration; }],
  ];

  for (const [legacyKey, legacyVal, canonicalKey, canonicalVal, normalize] of pairs) {
    if (legacyVal !== undefined && canonicalVal !== undefined) {
      if (legacyVal !== canonicalVal) {
        throw createError(
          ErrorCode.CC1002,
          {
            key: legacyKey,
            suggestion: `Conflicting configuration keys: '${legacyKey}' (${JSON.stringify(legacyVal)}) and '${canonicalKey}' (${JSON.stringify(canonicalVal)}) disagree. Use canonical '${canonicalKey}'.`,
          },
          { location: { file: configPath } },
        );
      }
      normalize();
    }
  }
}

export interface ValidationResult {
  readonly errors: CinecodeError[];
  readonly warnings: CinecodeError[];
}

function schemaError(issue: ZodValidationIssue, configPath: string | undefined): CinecodeError {
  if (issue.code === "unrecognized_keys") {
    const key = issue.path ? `${issue.path}.${issue.keys?.[0]}` : issue.keys?.[0];
    const removedHint = REMOVED_CONFIG_KEYS[key ?? ""];
    let suggestion: string;
    if (removedHint) {
      suggestion = removedHint;
    } else {
      const nearest = key ? suggestNearestKey(key) : undefined;
      suggestion = nearest ? `Did you mean '${nearest}'? ${SUPPORTED_KEYS_HINT}` : SUPPORTED_KEYS_HINT;
    }
    return createError(
      ErrorCode.CC1002,
      { key: key ?? "config", suggestion },
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

let authoringValidations = 0;
let normalizedValidations = 0;

/** How many times each schema ran in this process; the boundary tests assert one. */
export function configValidationCounts(): { readonly authoring: number; readonly normalized: number } {
  return { authoring: authoringValidations, normalized: normalizedValidations };
}

/** Validates the document a user writes. Used by load, validate and the helper. */
export function validateAuthoringConfig(raw: unknown, configPath?: string): ValidationResult {
  authoringValidations += 1;
  return { errors: schemaErrors(validateConfigWithZod(raw), configPath), warnings: [] };
}

/** Validates the normalized document consumers receive. */
export function validateNormalizedConfig(config: unknown, configPath?: string): ValidationResult {
  normalizedValidations += 1;
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

/** The one validation entry point used by validate, check and doctor. */
export function validateConfig(
  config: CinecodeConfig,
  configPath: string,
  root: string = dirname(resolve(configPath)),
): ValidationResult {
  const { errors } = validateNormalizedConfig(config, configPath);
  const warnings: CinecodeError[] = [];

  if (config.schemaVersion === 1) {
    warnings.push(createError(ErrorCode.CC1004, { version: "1", expected: "2" }, { location: findConfigLocation(configPath, "schemaVersion"), fixHint: "Schema v2 adds project/video/images/dev blocks; v1 still works.", severity: "warning" }));
  }

  errors.push(...validateProjectRoots(root, config, { configPath }));
  errors.push(...validateRootFilenames(config, { configPath }));

  const authored = authoredRoots(config);
  for (const [key, value] of [["sourceDir", authored.source], ["mediaDir", authored.media], ["outputDir", authored.output], ["cacheDir", authored.cache]] as const) {
    if (isAbsolute(value)) {
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
