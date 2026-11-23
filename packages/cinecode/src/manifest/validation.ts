import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CinecodeConfig, MainManifest, ManifestEntryBase } from "../core/types/index.js";
import { createError, ErrorCode, isCinecodeError, type CinecodeError } from "../errors/index.js";
import { validateManifestShape } from "../config/zod-schema.js";
import { loadModuleFile } from "./loader.js";
import { parseDurationInput } from "../core/time-input.js";
import { validateSerializableProps } from "../core/define/props.js";
import { checkEntryExport } from "./brands.js";
import { idRule } from "./ids.js";
import { assertDeterministicAuthoredModules } from "./determinism.js";
import { resolveMediaFilePath } from "../media/paths.js";
import { referenceWarnings } from "./references.js";
import { deepFreezeManifest } from "./contract.js";
import { validateEntryDuration, validateTimelineRefsDuration } from "./duration.js";

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
      const entryId = ((manifest as Record<string, unknown>)[colName] as ManifestEntryBase[] | undefined)?.[idx]?.id ?? colName;
      errors.push(createError(
        ErrorCode.CC3002,
        { clip: entryId, duration: String(issue.received ?? "") },
        { location: { file: manifestPath, clip: entryId }, fixHint: `Duration must be positive` },
      ));
    } else if (issue.message.includes('declares both "file" and "sceneRefs"')) {
      const parts = issue.path.split(".");
      const idx = parseInt(parts[1] || "0", 10);
      const timeline = manifest.timelines?.[idx];
      const sceneRef = timeline?.sceneRefs?.[0] ?? "scene";
      errors.push(createError(
        ErrorCode.CC3010,
        { timeline: timeline?.id ?? "timeline", scene: sceneRef },
        {
          location: { file: manifestPath, clip: timeline?.id },
          fixHint: `Remove "sceneRefs" from timeline "${timeline?.id}" to keep its file, or remove "file" to keep the scene references.`,
        },
      ));
    } else if (issue.message.includes("is not a filesystem-safe id") || issue.message.includes("duplicate id")) {
      const parts = issue.path.split(".");
      const colName = parts[0] ?? "entry";
      const idx = parseInt(parts[1] || "0", 10);
      const entryId = ((manifest as Record<string, unknown>)[colName] as ManifestEntryBase[] | undefined)?.[idx]?.id ?? issue.path;
      errors.push(createError(
        ErrorCode.CC1003,
        {
          key: issue.path || "id",
          path: String(entryId),
          reason: issue.message,
        },
        {
          location: { file: manifestPath },
          cause: issue,
          fixHint: issue.message.includes("duplicate id")
            ? "Change identifier so each entry has a unique id, including case-only differences"
            : "Use a name made of lowercase letters, digits, and dashes (e.g. 'intro-2'); ids become file names in the output root.",
        },
      ));
    } else {
      const isCustomReason = issue.message.includes("reserved");
      errors.push(createError(
        ErrorCode.CC1010,
        { path: manifestPath, reason: isCustomReason ? issue.message : `${issue.path || "manifest"}: ${issue.message}` },
        {
          location: { file: manifestPath },
          cause: issue,
          fixHint: issue.message.includes("reserved")
            ? 'Remove "characters" or "motions" from main.ts'
            : undefined,
        },
      ));
    }
  }

  // 2. Collections used for serializable props & entries check
  const collections = [
    { kind: "image", entries: manifest.images ?? [] },
    { kind: "audio", entries: manifest.audio ?? [] },
    { kind: "scene", entries: manifest.scenes ?? [] },
    { kind: "timeline", entries: manifest.timelines ?? [] },
  ] as const;

  // 3. Entry props must survive serialisation: the render pipeline reads them from a worker.
  for (const col of collections) {
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

  // 4. Validate references: sceneRefs, audioRef (case-insensitive)
  const sceneIds = new Map((manifest.scenes ?? []).map((s) => [s.id.toLowerCase(), s.id]));
  const audioIds = new Map((manifest.audio ?? []).map((a) => [a.id.toLowerCase(), a.id]));
  const availableScenes = Array.from(sceneIds.values()).join(", ") || "none";
  const availableAudio = Array.from(audioIds.values()).join(", ") || "none";

  const checkRef = (timelineId: string, ref: string, idMap: Map<string, string>, kind: string, available: string) => {
    if (!idMap.has(ref.toLowerCase())) {
      errors.push(createError(
        ErrorCode.CC3007,
        { kind: `${kind} (referenced by timeline "${timelineId}")`, id: ref, available },
        { location: { file: manifestPath, clip: timelineId }, fixHint: `Register ${kind} "${ref}" in ${kind} or fix reference in timeline "${timelineId}"` },
      ));
    }
  };

  for (const timeline of manifest.timelines ?? []) {
    if (timeline.file !== undefined && Array.isArray(timeline.sceneRefs) && timeline.sceneRefs.length > 0) {
      const sceneRef = timeline.sceneRefs[0] ?? "scene";
      if (!errors.some((e) => e.code === ErrorCode.CC3010 && e.message.includes(timeline.id))) {
        errors.push(createError(
          ErrorCode.CC3010,
          { timeline: timeline.id, scene: sceneRef },
          { location: { file: manifestPath, clip: timeline.id }, fixHint: `Remove "sceneRefs" from timeline "${timeline.id}" to keep its file, or remove "file" to keep the scene references.` },
        ));
      }
    }
    for (const ref of timeline.sceneRefs ?? []) checkRef(timeline.id, ref, sceneIds, "scene", availableScenes);
    for (const ref of timeline.audioRef ?? []) checkRef(timeline.id, ref, audioIds, "audio", availableAudio);
  }

  // 6, 7 & 8: Files, exported kinds, value ranges, media references
  for (const col of collections) {
    for (let i = 0; i < col.entries.length; i++) {
      const entry = col.entries[i] as ManifestEntryBase & {
        duration?: number | string;
        src?: string;
        gain?: number;
        sampleRate?: number;
        channels?: number;
        file?: string;
        [key: string]: unknown;
      };
      if (!entry) continue;

      if (entry.duration !== undefined) {
        const parsed = parseAndValidateDuration(entry.duration, fps);
        if (!parsed.valid) {
          if (typeof entry.duration === "string" && (entry.duration.includes(":") || parsed.error?.includes("timecode"))) {
            errors.push(createError(ErrorCode.CC1010, { path: manifestPath, reason: `entry "${entry.id}" duration timecode "${entry.duration}" is invalid for ${fps} fps: ${parsed.error}` }, { location: { file: manifestPath, clip: entry.id } }));
          } else {
            errors.push(createError(ErrorCode.CC3002, { clip: entry.id, duration: String(entry.duration) }, { location: { file: manifestPath, clip: entry.id }, fixHint: `Set a finite positive duration for entry "${entry.id}"` }));
          }
        }
      }

      if (col.kind === "audio") {
        if (entry.gain !== undefined && (typeof entry.gain !== "number" || !Number.isFinite(entry.gain) || entry.gain < 0 || entry.gain > 4)) {
          errors.push(createError(ErrorCode.CC1012, { reason: `Audio entry "${entry.id}" gain must be a number between 0 and 4, got ${entry.gain}` }, { location: { file: manifestPath, clip: entry.id }, fixHint: "Set gain between 0 (silent) and 4 (+12 dB)" }));
        }
        if (entry.sampleRate !== undefined && (typeof entry.sampleRate !== "number" || ![22050, 44100, 48000, 96000].includes(entry.sampleRate))) {
          errors.push(createError(ErrorCode.CC1012, { reason: `Audio entry "${entry.id}" sampleRate must be one of 22050, 44100, 48000, 96000, got ${entry.sampleRate}` }, { location: { file: manifestPath, clip: entry.id }, fixHint: "Use one of: 22050, 44100, 48000, 96000" }));
        }
        if (entry.channels !== undefined && entry.channels !== 1 && entry.channels !== 2) {
          errors.push(createError(ErrorCode.CC1012, { reason: `Audio entry "${entry.id}" channels must be 1 (mono) or 2 (stereo), got ${entry.channels}` }, { location: { file: manifestPath, clip: entry.id }, fixHint: "Set channels to 1 or 2" }));
        }
      }

      // Media references
      if (entry.src) {
        try {
          resolveMediaFilePath(entry.src, root, options.config, { reportNote: false });
        } catch (error) {
          if (isCinecodeError(error)) {
            errors.push(error);
          } else {
            errors.push(createError(ErrorCode.CC2001, { path: entry.src }, { cause: error }));
          }
        }
      }

      // Entry file validation
      if (entry.file) {
        if (isAbsolute(entry.file)) {
          errors.push(createError(
            ErrorCode.CC1003,
            {
              key: `${col.kind}s[${i}].file`,
              path: entry.file,
              reason: `entry "${entry.id}" declared path "${entry.file}" must be relative to the manifest`,
            },
            { location: { file: manifestPath, clip: entry.id } },
          ));
          continue;
        }

        const manifestDir = resolve(manifestPath, "..");
        const resolvedFile = resolve(manifestDir, entry.file);

        if (!existsSync(resolvedFile)) {
          errors.push(createError(
            ErrorCode.CC1009,
            { path: `${resolvedFile} (entry "${entry.id}", declared: "${entry.file}")` },
            {
              location: { file: resolvedFile, clip: entry.id },
              fixHint: `Create file "${resolvedFile}" for entry "${entry.id}" or update declared path "${entry.file}" in ${manifestPath}`,
            },
          ));
          continue;
        }

        const sourceDir = resolve(root, options.config.project?.sourceDir ?? options.config.sourceDir ?? "./src");
        let realFile = resolvedFile;
        try { realFile = realpathSync.native(resolvedFile); } catch { realFile = resolvedFile; }
        let realSource = sourceDir;
        try { realSource = realpathSync.native(sourceDir); } catch { realSource = sourceDir; }

        const relToSource = relative(realSource, realFile);
        const outsideSource = relToSource.startsWith("..") || isAbsolute(relToSource);
        const relToRoot = relative(root, realFile);
        const outsideRoot = relToRoot.startsWith("..") || isAbsolute(relToRoot);

        if (outsideRoot || (outsideSource && (options.config.project?.sourceDir !== undefined || options.config.sourceDir !== undefined))) {
          errors.push(createError(
            ErrorCode.CC1003,
            {
              key: `${col.kind}s[${i}].file`,
              path: entry.file,
              reason: `entry "${entry.id}" declared path "${entry.file}" resolves outside source directory "${realSource}" (resolved: "${realFile}")`,
            },
            { location: { file: manifestPath, clip: entry.id } },
          ));
          continue;
        }

        // Exported kind validation with cached module loading
        let moduleExports: unknown;
        try {
          if (options.moduleCache?.has(resolvedFile)) {
            moduleExports = options.moduleCache.get(resolvedFile);
          } else {
            moduleExports = await loadModuleFile<unknown>(resolvedFile, manifestDir, {});
            options.moduleCache?.set(resolvedFile, moduleExports);
            options.moduleCache?.set(entry.file, moduleExports);
          }
        } catch (error) {
          errors.push(createError(
            ErrorCode.CC1010,
            { path: entry.file, reason: `failed to load module for entry "${entry.id}": ${error instanceof Error ? error.message : String(error)}` },
            { location: { file: resolvedFile, clip: entry.id }, cause: error },
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
        } else if (col.kind === "scene" || col.kind === "timeline") {
          errors.push(...validateEntryDuration(entry, col.kind, moduleExports, fps, manifestPath));
        }
      } else if (col.kind === "timeline") {
        errors.push(...validateTimelineRefsDuration(entry, manifest.scenes, fps, manifestPath, options.moduleCache));
      }
    }
  }

  try {
    assertDeterministicAuthoredModules(manifest, manifestPath, root);
  } catch (error) {
    if (isCinecodeError(error)) {
      errors.push(error);
      const issues = (error as unknown as { issues?: unknown[] }).issues;
      if (Array.isArray(issues)) {
        for (const issue of issues) {
          if (issue !== error && isCinecodeError(issue)) errors.push(issue);
        }
      }
    }
  }

  for (const warning of referenceWarnings(manifest)) {
    if (warning.code === ErrorCode.CC3009) {
      warnings.push(warning);
    }
  }

  if (errors.length === 0) {
    deepFreezeManifest(manifest);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
