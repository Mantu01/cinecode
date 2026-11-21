import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CinecodeConfig, MainManifest, ManifestEntryBase } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { validateManifestShape } from "../config/zod-schema.js";
import { loadModuleFile } from "./loader.js";
import { hotReloadEnabled } from "../loader/index.js";
import { parseDurationInput } from "../core/time-input.js";
import { validateSerializableProps } from "../core/define/props.js";
import { checkEntryExport } from "./brands.js";
import { idRule } from "./ids.js";

/** Manifest keys that were accepted before and had no consumer. */
const REMOVED_MANIFEST_KEYS: Readonly<Record<string, string>> = {
  tags: "Removed; entry tags were never read by a command.",
  description: "Removed; entry descriptions were never displayed by a command.",
  "audio.format": "Removed; audio generation always writes a WAV file derived from sampleRate.",
};

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly CinecodeError[];
  readonly warnings: readonly CinecodeError[];
}

export interface ManifestValidationOptions {
  readonly rootDir: string;
  readonly manifestPath: string;
  readonly config: CinecodeConfig;
  readonly moduleCache?: Map<string, unknown>;
}

// Parses and validates a duration with the one time grammar.
export function parseAndValidateDuration(
  value: number | string,
  fps: number,
): { valid: boolean; seconds?: number; error?: string } {
  const parsed = parseDurationInput(value, fps);
  return parsed.ok ? { valid: true, seconds: parsed.seconds } : { valid: false, error: parsed.error };
}

// Validates the manifest document eagerly at resolution time.
export async function validateManifestDocument(
  raw: unknown,
  options: ManifestValidationOptions,
): Promise<ManifestValidationResult> {
  const errors: CinecodeError[] = [];
  const warnings: CinecodeError[] = [];
  const root = resolve(options.rootDir);
  const manifestPath = options.manifestPath;
  const fps = options.config.video?.fps ?? 30;
  const manifest = (raw ?? {}) as MainManifest;

  // 1. Validate shape and unknown keys via single schema source
  const shape = validateManifestShape(raw);
  for (const issue of shape.errors) {
    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys ?? [];
      for (const key of keys) {
        const fullKey = issue.path ? `${issue.path}.${key}` : key;
        const collection = issue.path.split(".")[0] ?? "";
        const suggestion =
          REMOVED_MANIFEST_KEYS[`${collection}.${key}`] ??
          REMOVED_MANIFEST_KEYS[key] ??
          "Supported manifest collections: images, audio, scenes, timelines.";
        errors.push(createError(
          ErrorCode.CC1002,
          { key: fullKey, suggestion },
          { location: { file: manifestPath } },
        ));
      }
    } else if (issue.path.includes("duration")) {
      const parts = issue.path.split(".");
      const colName = parts[0] ?? "";
      const idx = parseInt(parts[1] || "0", 10);
      const entryId = ((manifest as any)[colName]?.[idx] as ManifestEntryBase | undefined)?.id ?? colName;
      errors.push(createError(
        ErrorCode.CC3002,
        { clip: entryId, duration: String(issue.received ?? "") },
        { location: { file: manifestPath, clip: entryId }, fixHint: `Duration must be positive` },
      ));
    } else {
      errors.push(createError(
        ErrorCode.CC1010,
        { path: manifestPath, reason: `${issue.path || "manifest"}: ${issue.message}` },
        { location: { file: manifestPath }, cause: issue },
      ));
    }
  }

  // 2. Reject reserved-but-unused collections explicitly
  if (Array.isArray(manifest.characters) && manifest.characters.length > 0) {
    errors.push(createError(
      ErrorCode.CC1010,
      { path: manifestPath, reason: 'collection "characters" is reserved and not supported in this release; remove "characters" from the manifest' },
      { location: { file: manifestPath }, fixHint: 'Remove "characters" from main.ts' },
    ));
  }
  if (Array.isArray(manifest.motions) && manifest.motions.length > 0) {
    errors.push(createError(
      ErrorCode.CC1010,
      { path: manifestPath, reason: 'collection "motions" is reserved and not supported in this release; remove "motions" from the manifest' },
      { location: { file: manifestPath }, fixHint: 'Remove "motions" from main.ts' },
    ));
  }

  // 3. Entry props must survive serialisation: the render pipeline reads them from a worker.
  for (const col of [
    { kind: "image", entries: manifest.images ?? [] },
    { kind: "audio", entries: manifest.audio ?? [] },
    { kind: "scene", entries: manifest.scenes ?? [] },
    { kind: "timeline", entries: manifest.timelines ?? [] },
  ] as const) {
    for (let i = 0; i < col.entries.length; i++) {
      const entry = col.entries[i] as unknown as Record<string, unknown>;
      if (!entry) continue;
      for (const issue of validateSerializableProps(entry, `${col.kind}s[${i}]`)) {
        errors.push(createError(
          ErrorCode.CC1010,
          { path: manifestPath, reason: `${col.kind}s[${i}].${issue.prop}: ${issue.message}` },
          { location: { file: manifestPath, clip: String(entry.id ?? "") } },
        ));
      }
    }
  }

  // 4. Validate identity: unique ids across all referenceable collections
  const collections = [
    { kind: "image", entries: manifest.images ?? [] },
    { kind: "audio", entries: manifest.audio ?? [] },
    { kind: "scene", entries: manifest.scenes ?? [] },
    { kind: "timeline", entries: manifest.timelines ?? [] },
  ] as const;

  const seenIds = new Map<string, { kind: string; index: number; id: string }>();

  for (const col of collections) {
    for (let i = 0; i < col.entries.length; i++) {
      const entry = col.entries[i] as ManifestEntryBase;
      if (!entry || typeof entry.id !== "string" || !entry.id) continue;
      const key = entry.id.toLowerCase();
      if (seenIds.has(key)) {
        const prev = seenIds.get(key)!;
        const prevLoc = `${prev.kind}s[${prev.index}]`;
        const currLoc = `${col.kind}s[${i}]`;
        errors.push(createError(
          ErrorCode.CC1010,
          {
            path: manifestPath,
            reason: `duplicate id "${entry.id}" declared in ${prevLoc} and ${currLoc} (ids are compared case-insensitively)`,
          },
          {
            location: { file: manifestPath },
            fixHint: `Change identifier "${entry.id}" so each entry has a unique id, including case-only differences`,
          },
        ));
      } else {
        seenIds.set(key, { kind: col.kind, index: i, id: entry.id });
      }
    }
  }

  // 5. Validate references: sceneRefs, audioRef
  const sceneIds = new Set((manifest.scenes ?? []).map((s) => s.id));
  const audioIds = new Set((manifest.audio ?? []).map((a) => a.id));
  const availableScenes = Array.from(sceneIds).join(", ") || "none";
  const availableAudio = Array.from(audioIds).join(", ") || "none";

  for (const timeline of manifest.timelines ?? []) {
    if (Array.isArray(timeline.sceneRefs)) {
      for (const ref of timeline.sceneRefs) {
        if (!sceneIds.has(ref)) {
          errors.push(createError(
            ErrorCode.CC3007,
            {
              kind: `scene (referenced by timeline "${timeline.id}")`,
              id: ref,
              available: availableScenes,
            },
            {
              location: { file: manifestPath, clip: timeline.id },
              fixHint: `Register scene "${ref}" in scenes or fix reference in timeline "${timeline.id}"`,
            },
          ));
        }
      }
    }
    if (Array.isArray(timeline.audioRef)) {
      for (const ref of timeline.audioRef) {
        if (!audioIds.has(ref)) {
          errors.push(createError(
            ErrorCode.CC3007,
            {
              kind: `audio (referenced by timeline "${timeline.id}")`,
              id: ref,
              available: availableAudio,
            },
            {
              location: { file: manifestPath, clip: timeline.id },
              fixHint: `Register audio "${ref}" in audio or fix reference in timeline "${timeline.id}"`,
            },
          ));
        }
      }
    }
  }

  // 6, 7 & 8: Files, exported kinds, value ranges, media references
  for (const col of collections) {
    for (let i = 0; i < col.entries.length; i++) {
      const entry = col.entries[i] as any;
      if (!entry) continue;

      // Value ranges: duration validation
      if (entry.duration !== undefined) {
        const parsed = parseAndValidateDuration(entry.duration, fps);
        if (!parsed.valid) {
          if (typeof entry.duration === "string" && (entry.duration.includes(":") || parsed.error?.includes("timecode"))) {
            errors.push(createError(
              ErrorCode.CC1010,
              { path: manifestPath, reason: `entry "${entry.id}" duration timecode "${entry.duration}" is invalid for ${fps} fps: ${parsed.error}` },
              { location: { file: manifestPath, clip: entry.id } },
            ));
          } else {
            errors.push(createError(
              ErrorCode.CC3002,
              { clip: entry.id, duration: String(entry.duration) },
              { location: { file: manifestPath, clip: entry.id }, fixHint: `Set a finite positive duration for entry "${entry.id}"` },
            ));
          }
        }
      }

      // Media references
      if (col.kind === "audio" && entry.src) {
        const mediaDir = resolve(root, options.config.mediaDir ?? "media");
        const sourceDir = resolve(root, options.config.sourceDir ?? "src");
        const allowCoLocated = options.config.allowCoLocatedMedia === true;
        const inMedia = resolve(mediaDir, entry.src);
        const inSource = resolve(sourceDir, entry.src);
        const relMedia = relative(root, inMedia);
        if (relMedia.startsWith("..") || isAbsolute(relMedia)) {
          errors.push(createError(
            ErrorCode.CC1003,
            {
              key: `audio[${i}].src`,
              path: entry.src,
              reason: `audio entry "${entry.id}" declared source "${entry.src}" resolves outside project root "${root}"`,
            },
            { location: { file: manifestPath } },
          ));
        } else {
          const found = existsSync(inMedia) ? inMedia : (allowCoLocated && existsSync(inSource) ? inSource : null);
          if (!found) {
            const searched = [inMedia];
            if (allowCoLocated) searched.push(inSource);
            else searched.push(`${inSource} (co-located search disabled; enable allowCoLocatedMedia in config)`);
            errors.push(createError(
              ErrorCode.CC2001,
              { path: `${entry.src} (entry "${entry.id}"). Searched locations:\n  - ${searched.join("\n  - ")}` },
              { location: { file: manifestPath, clip: entry.id }, fixHint: `Verify audio source exists in media root at ${inMedia}` },
            ));
          }
        }
      }

      // Entry file validation
      if (entry.file) {
        const resolvedFile = resolve(root, entry.file);
        const relFile = relative(root, resolvedFile);
        if (relFile.startsWith("..") || isAbsolute(relFile)) {
          errors.push(createError(
            ErrorCode.CC1003,
            {
              key: `${col.kind}s[${i}].file`,
              path: entry.file,
              reason: `entry "${entry.id}" declared path "${entry.file}" resolves outside project root "${root}" (resolved: "${resolvedFile}")`,
            },
            { location: { file: manifestPath } },
          ));
          continue;
        }

        if (!existsSync(resolvedFile)) {
          errors.push(createError(
            ErrorCode.CC1009,
            { path: `${resolvedFile} (entry "${entry.id}", declared: "${entry.file}")` },
            {
              location: { file: resolvedFile },
              fixHint: `Create file "${resolvedFile}" for entry "${entry.id}" or update declared path "${entry.file}" in ${manifestPath}`,
            },
          ));
          continue;
        }

        // Exported kind validation with cached module loading
        let moduleExports: unknown;
        try {
          if (options.moduleCache?.has(resolvedFile)) {
            moduleExports = options.moduleCache.get(resolvedFile);
          } else {
            moduleExports = await loadModuleFile<unknown>(entry.file, root, { fresh: hotReloadEnabled() });
            options.moduleCache?.set(resolvedFile, moduleExports);
            options.moduleCache?.set(entry.file, moduleExports);
          }
        } catch (error) {
          errors.push(createError(
            ErrorCode.CC1010,
            { path: entry.file, reason: `failed to load module for entry "${entry.id}": ${error instanceof Error ? error.message : String(error)}` },
            { location: { file: resolvedFile }, cause: error },
          ));
          continue;
        }

        const exported = checkEntryExport(col.kind, moduleExports);
        if (!exported.ok) {
          errors.push(createError(
            ErrorCode.CC3008,
            {
              path: entry.file,
              expected: `${exported.expected} for entry "${entry.id}"; received ${exported.received}`,
            },
            {
              location: { file: resolvedFile, clip: entry.id },
              fixHint: `Export ${exported.expected} from "${entry.file}" for entry "${entry.id}"`,
            },
          ));
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
