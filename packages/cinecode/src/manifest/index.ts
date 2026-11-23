import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AnyTrack,
  AudioClip,
  Clip,
  CinecodeConfig,
  Composition,
  MainManifest,
  Timeline,
  AudioPlacement,
} from "../core/types/index.js";
import type { AudioBuffer } from "../audio/types.js";
import type { AudioDef, ImageDef, SceneDef, SoundContext } from "../core/define/definitions.js";
import {
  audioTrack as makeAudioTrack,
  composition as makeComposition,
  timeline as makeTimeline,
  track as makeTrack,
} from "../core/clips/builders.js";
import { createConversion } from "../core/time/index.js";
import { computeClipSpan } from "../core/validation/index.js";
import { loadModuleFile, resolveEntryFile } from "./loader.js";
import { loadUserModuleNamespace } from "../loader/index.js";
import { assertMainContract, deepFreezeManifest } from "./contract.js";
import { assertDeterministicAuthoredModules } from "./determinism.js";
import { idRule, type ManifestId } from "./ids.js";
import { checkDeclaredDuration, computeTimelineContentDuration, compareDuration, type DurationComparison, type DurationStatus, type TimelineDurationResult } from "./duration.js";
import { createError, ErrorCode } from "../errors/index.js";
import {
  parseAndValidateDuration,
  validateManifestDocument,
  type ManifestValidationOptions,
  type ManifestValidationResult,
} from "./validation.js";
import { resolveCompositionGeometry, applyCompositionGeometry } from "./target.js";

export { defineMain } from "../core/define/definitions.js";
export { deepFreezeManifest } from "./contract.js";
export type { ManifestId } from "./ids.js";
export * from "./target.js";

export interface ManifestProject {
  readonly rootDir: string;
  readonly entryPath: string;
  readonly config: CinecodeConfig;
  readonly manifest: MainManifest;
  readonly hasManifest: boolean;
  readonly rawManifest?: unknown;
  readonly validation?: ManifestValidationResult;
  readonly moduleCache?: Map<string, unknown>;
}

export function normalizeManifest(raw: unknown, manifestPath = "main.ts"): MainManifest {
  const manifest = (raw ?? {}) as MainManifest;
  return deepFreezeManifest({
    images: manifest.images ?? [],
    audio: manifest.audio ?? [],
    scenes: manifest.scenes ?? [],
    timelines: manifest.timelines ?? [],
  });
}

/** Loads the root manifest (`main.ts`); the caller decides whether a missing one is fatal. */
export async function loadManifestProject(
  config: CinecodeConfig,
  rootDir = process.cwd(),
): Promise<ManifestProject> {
  const entry = config.project?.entry ?? "./main.ts";
  const entryPath = resolveEntryFile(entry, rootDir);
  if (!existsSync(entryPath)) {
    return { rootDir, entryPath, config, manifest: normalizeManifest({}, entryPath), hasManifest: false };
  }
  const mod = await loadUserModuleNamespace<Record<string, unknown>>(entry, rootDir, {});
  if (!("default" in mod) || mod.default === undefined) {
    throw createError(
      ErrorCode.CC1010,
      {
        path: entryPath,
        reason: "the entry file must default-export defineMain({ images, audio, scenes, timelines }), but it exported a named-only export (no default export)",
      },
      {
        location: { file: entryPath },
        fixHint: "Default-export defineMain({ images, audio, scenes, timelines }).",
      },
    );
  }
  const definition = assertMainContract(mod.default, entryPath);
  assertDeterministicAuthoredModules(definition, entryPath, rootDir);
  return {
    rootDir,
    entryPath,
    config,
    manifest: normalizeManifest(definition, entryPath),
    hasManifest: true,
    rawManifest: definition,
  };
}

export function assertSelectorId(kind: string, id: string): ManifestId {
  const rule = idRule(id);
  if (rule) throw createError(ErrorCode.CC1012, { reason: `Invalid ${kind} id "${id}": ${rule}` });
  return id as ManifestId;
}

export function findEntry<T extends { id: string }>(
  entries: readonly T[] | undefined,
  id: string,
  kind: string,
): T {
  assertSelectorId(kind, id);
  const targetKey = id.toLowerCase();
  const found = entries?.find((entry) => entry.id.toLowerCase() === targetKey);
  if (!found) {
    const available = (entries ?? []).map((entry) => entry.id).join(", ") || "none";
    throw createError(ErrorCode.CC3007, { kind, id, available });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

export function timelineDurationSeconds(timeline: Timeline, fps: number): number {
  return computeTimelineContentDuration(timeline, fps).seconds;
}

export function toSeconds(
  value: number | string | undefined,
  fps: number = 30,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseAndValidateDuration(value, fps);
  return parsed.valid ? parsed.seconds : undefined;
}

/** Shifts every clip in a timeline forward by `offsetSeconds`. */
export function shiftTimeline(timeline: Timeline, offsetSeconds: number): Timeline {
  if (offsetSeconds === 0) return timeline;
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const start = typeof clip.start === "number" ? clip.start : 0;
      return { ...clip, start: start + offsetSeconds };
    }),
  })) as readonly AnyTrack[];
  return { ...timeline, tracks };
}

export * from "./assembly.js";
export * from "./audio-resolve.js";
export * from "./duration.js";

export { makeTrack, makeTimeline, resolveEntryFile, validateManifestDocument, parseAndValidateDuration };
export type { ManifestValidationResult, ManifestValidationOptions };
