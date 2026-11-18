import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CinecodeConfig, MainManifest, ManifestEntryBase } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { validateManifestShape } from "../config/zod-schema.js";
import { loadModuleFile } from "./loader.js";
import { hotReloadEnabled } from "../loader/index.js";

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

// Parses and validates a duration number or timecode against project fps.
export function parseAndValidateDuration(
  value: number | string,
  fps: number,
): { valid: boolean; seconds?: number; error?: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return { valid: false, error: `Duration must be a finite positive number, got ${value}` };
    }
    return { valid: true, seconds: value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, error: "Duration string cannot be empty" };
    if (trimmed.includes(":")) {
      const parts = trimmed.split(":");
      if (parts.length < 2 || parts.length > 4) {
        return { valid: false, error: `Invalid timecode "${value}". Expected HH:MM:SS or HH:MM:SS:FF` };
      }
      for (const part of parts) {
        if (!/^\d+$/.test(part)) {
          return { valid: false, error: `Invalid timecode part "${part}" in "${value}". Numeric digits required` };
        }
      }
      const numParts = parts.map(Number);
      if (parts.length === 4) {
        const [h, m, s, f] = numParts;
        if (m! >= 60 || s! >= 60) return { valid: false, error: `Invalid timecode "${value}": minutes/seconds must be < 60` };
        if (f! >= fps) return { valid: false, error: `Invalid timecode "${value}": frame ${f} exceeds project frame rate (${fps} fps)` };
        const seconds = h! * 3600 + m! * 60 + s! + f! / fps;
        return seconds > 0 ? { valid: true, seconds } : { valid: false, error: `Duration must be positive, got ${seconds}s` };
      }
      if (parts.length === 3) {
        const [h, m, s] = numParts;
        if (m! >= 60 || s! >= 60) return { valid: false, error: `Invalid timecode "${value}": minutes/seconds must be < 60` };
        const seconds = h! * 3600 + m! * 60 + s!;
        return seconds > 0 ? { valid: true, seconds } : { valid: false, error: `Duration must be positive, got ${seconds}s` };
      }
      if (parts.length === 2) {
        const [m, s] = numParts;
        if (s! >= 60) return { valid: false, error: `Invalid timecode "${value}": seconds must be < 60` };
        const seconds = m! * 60 + s!;
        return seconds > 0 ? { valid: true, seconds } : { valid: false, error: `Duration must be positive, got ${seconds}s` };
      }
    }
    const sMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s$/i);
    if (sMatch) {
      const parsed = parseFloat(sMatch[1]!);
      return parsed > 0 ? { valid: true, seconds: parsed } : { valid: false, error: `Duration must be positive, got ${parsed}` };
    }
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = parseFloat(trimmed);
      return parsed > 0 ? { valid: true, seconds: parsed } : { valid: false, error: `Duration must be positive, got ${parsed}` };
    }
    return { valid: false, error: `Unrecognized duration/timecode format "${value}"` };
  }
  return { valid: false, error: `Duration must be number or string, got ${typeof value}` };
}

function checkKindExport(kind: string, raw: unknown): boolean {
  if (!raw) return false;
  if (kind === "image") {
    if (typeof raw === "object" && (raw as { kind?: string }).kind === "image") return true;
    if (typeof raw === "function") return true;
    if (typeof raw === "object" && ("type" in (raw as object) || "kind" in (raw as object))) return true;
    return false;
  }
  if (kind === "audio") {
    if (typeof raw === "object" && ((raw as { kind?: string }).kind === "audio" || (raw as { kind?: string }).kind === "sound")) return true;
    if (typeof raw === "object" && "data" in (raw as object) && "sampleRate" in (raw as object)) return true;
    if (typeof raw === "function") return true;
    return false;
  }
  if (kind === "scene") {
    if (typeof raw === "object" && (raw as { kind?: string }).kind === "scene") return true;
    if (typeof raw === "object" && Array.isArray((raw as { tracks?: unknown }).tracks)) return true;
    if (typeof raw === "object" && "rootTimeline" in (raw as object)) return true;
    if (typeof raw === "function" || Array.isArray(raw)) return true;
    return false;
  }
  if (kind === "timeline") {
    if (typeof raw === "object" && Array.isArray((raw as { tracks?: unknown }).tracks)) return true;
    if (typeof raw === "object" && "rootTimeline" in (raw as object)) return true;
    if (typeof raw === "object" && (raw as { kind?: string }).kind === "scene") return true;
    if (typeof raw === "function") return true;
    return false;
  }
  return false;
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
        errors.push(createError(
          ErrorCode.CC1002,
          { key: fullKey, suggestion: "Supported manifest collections: images, audio, scenes, timelines." },
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

  // 3. Validate identity: unique ids across all referenceable collections
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
      if (seenIds.has(entry.id)) {
        const prev = seenIds.get(entry.id)!;
        const prevLoc = `${prev.kind}s[${prev.index}]`;
        const currLoc = `${col.kind}s[${i}]`;
        errors.push(createError(
          ErrorCode.CC1010,
          {
            path: manifestPath,
            reason: `duplicate id "${entry.id}" declared in ${prevLoc} and ${currLoc}`,
          },
          {
            location: { file: manifestPath },
            fixHint: `Change identifier "${entry.id}" so each entry has a unique id`,
          },
        ));
      } else {
        seenIds.set(entry.id, { kind: col.kind, index: i, id: entry.id });
      }
    }
  }

  // 4. Validate references: sceneRefs, audioRef
  const sceneIds = new Set((manifest.scenes ?? []).map((s) => s.id));
  const audioIds = new Set((manifest.audio ?? []).map((a) => a.id));
  const availableScenes = Array.from(sceneIds).join(", ") || "none";
  const availableAudio = Array.from(audioIds).join(", ") || "none";
  const referencedAudio = new Set<string>();

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
        referencedAudio.add(ref);
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

  // 5, 6, 7 & 8: Files, exported kinds, value ranges, media references
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
        } else if (referencedAudio.has(entry.id)) {
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

        if (!checkKindExport(col.kind, moduleExports)) {
          errors.push(createError(
            ErrorCode.CC3008,
            {
              path: `${entry.file} (entry "${entry.id}")`,
              expected: `a ${col.kind} (define${col.kind.charAt(0).toUpperCase() + col.kind.slice(1)})`,
            },
            {
              location: { file: resolvedFile },
              fixHint: `Export ${col.kind} definition from "${entry.file}" for entry "${entry.id}"`,
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
