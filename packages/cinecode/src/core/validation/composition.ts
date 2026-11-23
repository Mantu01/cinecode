// Size exception (>400 lines): single source of truth for composition validation gates per quality-standards §2.
import type { Clip, Composition, VisualClip } from "../types/index.js";
import { createConversion } from "../time/index.js";
import { timeInputToFrames } from "../time/convert.js";
import { findTimelineOvershoots } from "../time/timeline.js";
import { listEffects, listTransitions } from "../../extensions/index.js";
import { createError, ErrorCode, type CinecodeError } from "../../errors/index.js";
import {
  AUTHORING_CODES,
  authoringIssue,
  type ValidationIssue,
} from "./errors.js";
import { computeClipSpan } from "./timeline.js";

export const CLIP_TYPES = new Set([
  "video",
  "image",
  "text",
  "shape",
  "solid",
  "group",
  "scene",
  "component",
  "audio",
  "sound",
  "tts",
  "model3d",
  "svg",
  "particle",
  "noise",
  "audioVisualizer",
  "chromakey",
  "subtitle",
  "dataViz",
  "sticker",
  "gradient-mesh",
  "meshwarp",
  "text3d",
  "multiCamera",
]);

const REQUIRED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  video: ["src"],
  image: ["src"],
  audio: ["src"],
  sound: ["ref"],
  tts: ["text"],
  text: ["content", "fontSize"],
  shape: ["shapeType"],
  solid: ["color"],
  group: ["children"],
  scene: ["ref"],
  component: ["ref"],
  model3d: ["src"],
  chromakey: ["src"],
  meshwarp: ["src"],
  particle: ["params"],
  noise: ["params"],
  audioVisualizer: ["trackRef"],
  dataViz: ["data", "chartType"],
  sticker: ["emoji", "size"],
  "gradient-mesh": ["gridCols", "gridRows", "anchors"],
  text3d: ["content", "fontSize"],
  multiCamera: ["src", "cameras"],
};

export interface CompositionValidation {
  readonly composition: string;
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly checkedClips: number;
}

export interface CompositionValidationOptions {
  readonly effects?: readonly string[];
  readonly transitions?: readonly string[];
}

function isInvalidTime(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return value.trim() === "" || Number.isNaN(parseFloat(value));
  return true;
}

function timecode(frame: number, fps: number): string {
  const total = Math.max(0, frame) / fps;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const frames = Math.round((total % 1) * fps);
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

function issueAt(
  issue: ValidationIssue,
  name: string,
  track: string | undefined,
  frame: number,
  fps: number,
): ValidationIssue {
  return { ...issue, clipName: name, trackName: track, timecode: timecode(frame, fps) };
}

/**
 * Structural and registry validation for one resolved composition. No media
 * decoding and no frame rendering: only graph and value checks, so it is cheap
 * enough to run before every render.
 */
export function validateComposition(
  composition: Composition,
  options: CompositionValidationOptions = {},
): CompositionValidation {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const fps = composition.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    errors.push(
      authoringIssue(AUTHORING_CODES.invalidComposition, `Composition "${composition.name}" has an invalid fps: ${fps}`, {
        trackName: undefined,
        hint: "Set fps to a positive number.",
      }),
    );
    return { composition: composition.name, valid: false, errors, warnings, checkedClips: 0 };
  }
  if (!Number.isInteger(composition.width) || composition.width <= 0 || !Number.isInteger(composition.height) || composition.height <= 0) {
    errors.push(
      authoringIssue(AUTHORING_CODES.invalidComposition, `Composition "${composition.name}" has an invalid resolution: ${composition.width}x${composition.height}`, {
        hint: "Width and height must be positive integers.",
      }),
    );
  }

  const conversion = createConversion(fps);
  const effects = options.effects ?? listEffects();
  const transitions = options.transitions ?? listTransitions();
  const effectSet = new Set(effects);
  const transitionSet = new Set(transitions);
  const tracks = composition.rootTimeline.tracks;
  const seenNames = new Map<string, number>();
  let checkedClips = 0;

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex]!;
    if (track.name !== undefined) {
      const previous = seenNames.get(track.name);
      if (previous !== undefined) {
        errors.push(
          authoringIssue(AUTHORING_CODES.invalidComposition, `Duplicate track name "${track.name}" (tracks ${previous} and ${trackIndex})`, {
            trackName: track.name,
            hint: "Track names identify layers in diagnostics and transitions; make them unique.",
          }),
        );
      } else {
        seenNames.set(track.name, trackIndex);
      }
    }

    const spans = track.clips.map((clip) => computeClipSpan(clip as Clip, conversion));
    spans.sort((a, b) => a.startFrames - b.startFrames);

    for (const span of spans) {
      const clip = span.clip as Clip;
      const name = clipNameOf(clip);
      const type = (clip as { type: unknown }).type;
      checkedClips += 1;

      if (isInvalidTime(clip.start) || isInvalidTime(clip.end) || isInvalidTime(clip.duration)) {
        errors.push(
          issueAt(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" has a non-finite start, end or duration`, {
              hint: "Use finite seconds, timecodes or frame numbers.",
            }),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
        continue;
      }
      if (typeof type !== "string" || !CLIP_TYPES.has(type)) {
        errors.push(
          issueAt(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" has unknown type "${String(type)}"`, {
              hint: `Use one of: ${[...CLIP_TYPES].join(", ")}`,
            }),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
        continue;
      }
      if (span.declared) {
        errors.push(
          issueAt(
            authoringIssue(AUTHORING_CODES.invalidDuration, `Clip "${name}" has zero or negative duration`),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
        continue;
      }
      if (span.startFrames < 0) {
        errors.push(
          issueAt(
            authoringIssue(AUTHORING_CODES.outsideComposition, `Clip "${name}" starts before the composition start`),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
      }

      if (type === "component") {
        errors.push(
          issueAt(
            authoringIssue(
              AUTHORING_CODES.invalidComposition,
              `Unsupported clip type "component" (clip "${name}"): flatten the component into the timeline or render it directly`,
              {
                hint: "Flatten the component into the timeline or render it directly.",
              },
            ),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
        continue;
      }

      if (type === "scene") {
        const sceneClip = clip as { ref?: string; timeline?: unknown };
        const scenes = composition.scenes as Record<string, unknown> | undefined;
        const hasNested = Boolean(sceneClip.timeline || (sceneClip.ref && scenes && scenes[sceneClip.ref]));
        if (!hasNested) {
          errors.push(
            issueAt(
              authoringIssue(
                AUTHORING_CODES.invalidComposition,
                `Clip "${name}" (scene) references unresolved scene "${sceneClip.ref ?? "unnamed"}": provide scene in composition or flatten the scene into the timeline or render it directly`,
                {
                  hint: "Provide the referenced scene in composition.scenes, or flatten the scene into the timeline or render it directly.",
                },
              ),
              name,
              track.name,
              span.startFrames,
              fps,
            ),
          );
          continue;
        }
      }

      for (const property of REQUIRED_PROPERTIES[type] ?? []) {
        if (type === "audio" && property === "src" && (clip as { buffer?: unknown }).buffer) continue;
        const value = (clip as unknown as Record<string, unknown>)[property];
        if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
          errors.push(
            issueAt(
              authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" (${type}) is missing required property "${property}"`),
              name,
              track.name,
              span.startFrames,
              fps,
            ),
          );
        }
      }
      if (type === "svg" && !(clip as { content?: string }).content && !(clip as { src?: string }).src) {
        errors.push(
          issueAt(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" (svg) requires either "content" or "src"`),
            name,
            track.name,
            span.startFrames,
            fps,
          ),
        );
      }

      for (const effect of (clip as VisualClip).effects ?? []) {
        if (!effectSet.has(effect.name)) {
          errors.push(
            issueAt(
              authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" references unknown effect "${effect.name}"`, {
                hint: `Available effects: ${effects.join(", ") || "none"}`,
              }),
              name,
              track.name,
              span.startFrames,
              fps,
            ),
          );
        }
      }
      for (const key of ["transitionIn", "transitionOut"] as const) {
        const ref = (clip as VisualClip)[key];
        if (ref && !transitionSet.has(ref.name)) {
          errors.push(
            issueAt(
              authoringIssue(AUTHORING_CODES.invalidComposition, `Clip "${name}" references unknown ${key} "${ref.name}"`, {
                hint: `Available transitions: ${transitions.join(", ") || "none"}`,
              }),
              name,
              track.name,
              span.startFrames,
              fps,
            ),
          );
        }
      }
    }

    for (let i = 1; i < spans.length; i += 1) {
      const previous = spans[i - 1]!;
      const current = spans[i]!;
      if (current.startFrames >= previous.endFrames) continue;
      const allowed =
        (current.clip as VisualClip).transitionIn !== undefined ||
        (previous.clip as VisualClip).transitionOut !== undefined ||
        (previous.clip as VisualClip).transitionIn !== undefined ||
        (current.clip as VisualClip).transitionOut !== undefined;
      if (allowed) continue;
      const name = clipNameOf(current.clip);
      errors.push(
        issueAt(
          authoringIssue(
            AUTHORING_CODES.overlappingClips,
            `Clip "${name}" overlaps the previous clip on track "${track.name ?? "unnamed"}"`,
            { hint: "Give the incoming clip a transitionIn or the outgoing clip a transitionOut to allow the overlap." },
          ),
          name,
          track.name,
          current.startFrames,
          fps,
        ),
      );
    }
  }

  if (composition.duration !== undefined) {
    const durationFrames = timeInputToFramesSafe(composition.duration, conversion);
    if (durationFrames !== undefined) {
      const behavior = composition.boundaryBehavior ?? "clamp";
      if (behavior !== "extend") {
        for (const overshoot of findTimelineOvershoots(composition.rootTimeline, conversion, durationFrames)) {
          const issue = authoringIssue(
            AUTHORING_CODES.timelineOvershoot,
            `Clip "${overshoot.clipName}" overshoots the composition boundary by ${overshoot.overshootFrames} frame(s)`,
            {
              clipName: overshoot.clipName,
              trackName: overshoot.trackName,
              timecode: timecode(durationFrames, fps),
              hint: behavior === "strict" ? "Trim the clip or raise composition.duration" : "The clip will be clamped to the composition duration",
            },
          );
          (behavior === "strict" ? errors : warnings).push(
            behavior === "strict" ? issue : { ...issue, severity: "warning" },
          );
        }
      }
    }
  }

  const config = composition.splitScreen;
  if (config) {
    const visualTracks = tracks.filter((track) => track.kind !== "audio" && track.kind !== "subtitle").length;
    const regions = config.regions ?? [];
    for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
      const region = regions[regionIndex]!;
      const source = region.track ?? (Number.isInteger(region.clipIndex) ? `track ${region.clipIndex}` : "no source");
      if (
        !Number.isFinite(region.x) ||
        !Number.isFinite(region.y) ||
        !Number.isFinite(region.width) ||
        !Number.isFinite(region.height) ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.x < 0 ||
        region.y < 0 ||
        region.x + region.width > 1.000001 ||
        region.y + region.height > 1.000001
      ) {
        errors.push(
          authoringIssue(AUTHORING_CODES.invalidComposition, `Split-screen region ${regionIndex} (${source}) has an invalid rectangle`, {
            hint: "Region rectangles must be non-zero, finite and inside the composition bounds.",
          }),
        );
      }
      if (region.track !== undefined) {
        const track = tracks.find((entry) => entry.name === region.track);
        if (!track || track.kind === "audio" || track.kind === "subtitle") {
          errors.push(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Split-screen region ${regionIndex} references missing track "${region.track}"`, {
              hint: "Use the name of a visual track declared in the composition.",
            }),
          );
        }
      } else if (!Number.isInteger(region.clipIndex) || region.clipIndex < 0 || region.clipIndex >= visualTracks) {
        errors.push(
          authoringIssue(AUTHORING_CODES.invalidComposition, `Split-screen region ${regionIndex} references missing track index ${region.clipIndex}`, {
            hint: `Regions may reference track indexes 0-${Math.max(0, visualTracks - 1)}; found ${visualTracks} visual track(s).`,
          }),
        );
      }
    }
    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        const a = regions[i]!;
        const b = regions[j]!;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapX > 0 && overlapY > 0) {
          errors.push(
            authoringIssue(AUTHORING_CODES.invalidComposition, `Split-screen regions ${i} and ${j} overlap`, {
              hint: "Region rectangles must not overlap.",
            }),
          );
        }
      }
    }
  }

  return { composition: composition.name, valid: errors.length === 0, errors, warnings, checkedClips };
}

function clipNameOf(clip: Clip): string {
  const named = clip as { name?: string };
  return named.name ?? clip.type;
}

function timeInputToFramesSafe(value: number | string, conversion: ReturnType<typeof createConversion>): number | undefined {
  try {
    const frames = timeInputToFrames(value, conversion);
    return Number.isFinite(frames) ? frames : undefined;
  } catch {
    return undefined;
  }
}

/** Converts fatal validation issues into one coded error that names the first offender. */
export function compositionValidationError(
  result: CompositionValidation,
  file?: string,
): CinecodeError {
  const first = result.errors[0]!;
  const error = createError(
    ErrorCode.CC1013,
    { count: result.errors.length },
    {
      location: {
        file,
        clip: first.clipName,
        track: first.trackName,
        time: first.timecode,
      },
      fixHint: first.hint,
    },
  );
  error.message = `${error.message}: [${first.code}] ${first.message}`;
  (error as CinecodeError & { issues?: readonly ValidationIssue[] }).issues = result.errors;
  return error;
}
