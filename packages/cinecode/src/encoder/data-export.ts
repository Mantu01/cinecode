import type { Clip, ColorSpec, Composition } from "../core/types/index.js";
import { allClips } from "../core/types/tracks.js";
import { compositionConversion, compositionTotalFrames, createConversion, durationToFrames, frameToSeconds, type FrameConversion } from "../core/time/index.js";
import { formatTimecode } from "../core/time/format.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { parseTimeInput, parseDurationInput } from "../core/time-input.js";

function toSecondsOrFrames(value: number | string | undefined, fps: number, fallbackFrames: number): number {
  if (value === undefined) return fallbackFrames;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * fps) : fallbackFrames;
  const parsed = parseTimeInput(value, fps);
  return parsed.ok ? Math.round(parsed.time.frame) : fallbackFrames;
}

function manifestDurationSeconds(value: number | string | undefined, fps: number, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = parseDurationInput(value, fps);
    return parsed.ok ? parsed.seconds : fallback;
  }
  return fallback;
}

export interface ManifestJsonExport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number | string | undefined;
  readonly background: ColorSpec | undefined;
  readonly tracks: readonly {
    readonly name: string;
    readonly kind: string;
    readonly clips: readonly Record<string, unknown>[];
  }[];
}

export function exportManifestJson(composition: Composition): ManifestJsonExport {
  const timeline = composition.rootTimeline;
  return {
    name: composition.name,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    duration: composition.duration,
    background: composition.background,
    tracks: timeline.tracks.map((track) => ({
      name: track.name ?? "unnamed",
      kind: track.kind ?? "visual",
      clips: track.clips.map((clip) => {
        const base: Record<string, unknown> = {
          type: clip.type,
          start: clip.start,
          end: clip.end,
          duration: clip.duration,
        };
        if ("src" in clip && clip.src !== undefined) base.src = clip.src;
        if ("content" in clip && clip.content !== undefined) base.content = clip.content;
        if ("ref" in clip && clip.ref !== undefined) base.ref = clip.ref;
        return base;
      }),
    })),
  };
}

export interface ClipReportEntry {
  readonly type: string;
  readonly name: string | undefined;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly startTc: string;
  readonly endTc: string;
  readonly src?: string;
}

export interface ClipReport {
  readonly composition: string;
  readonly fps: number;
  readonly totalFrames: number;
  readonly clips: readonly ClipReportEntry[];
}

function clipStartFrame(clip: Clip, fps: number): number {
  return toSecondsOrFrames(clip.start, fps, 0);
}

function clipEndFrame(clip: Clip, fps: number, compositionDuration: number | string | undefined): number {
  if (clip.end !== undefined) return toSecondsOrFrames(clip.end, fps, 0);
  const startFrame = clipStartFrame(clip, fps);
  if (clip.duration !== undefined) return startFrame + toSecondsOrFrames(clip.duration, fps, 0);
  const durationSeconds = manifestDurationSeconds(compositionDuration, fps);
  if (durationSeconds > 0) return durationToFrames(durationSeconds, createConversion(fps));
  return startFrame + 1;
}

export function exportClipReport(composition: Composition): ClipReport {
  const conversion = compositionConversion(composition);
  const totalFrames = compositionTotalFrames(composition);
  const clips = allClips(composition.rootTimeline);
  const entries: ClipReportEntry[] = clips.map((clip, index) => {
    const startFrame = Math.max(0, clipStartFrame(clip, composition.fps));
    const endFrame = Math.min(totalFrames > 0 ? totalFrames : Number.MAX_SAFE_INTEGER, clipEndFrame(clip, composition.fps, composition.duration));
    const base: ClipReportEntry = {
      type: clip.type,
      name: (clip as { name?: string }).name ?? `clip-${index}`,
      startFrame,
      endFrame,
      startTc: formatTimecode(startFrame, conversion),
      endTc: formatTimecode(endFrame, conversion),
    };
    if ("src" in clip && clip.src !== undefined) return { ...base, src: clip.src };
    return base;
  });
  return { composition: composition.name, fps: composition.fps, totalFrames, clips: entries };
}

export interface TimecodeLogEntry {
  readonly frame: number;
  readonly timecode: string;
  readonly seconds: number;
}

export function exportTimecodeLog(composition: Composition, conversion?: FrameConversion): readonly TimecodeLogEntry[] {
  const conv = conversion ?? compositionConversion(composition);
  const totalFrames = compositionTotalFrames(composition);
  const log: TimecodeLogEntry[] = [];
  for (let frame = 0; frame < totalFrames; frame += 1) {
    log.push({ frame, timecode: formatTimecode(frame, conv), seconds: frameToSeconds(frame, conv) });
  }
  return log;
}

async function writeJson(path: string, data: unknown, overwrite: boolean): Promise<string> {
  if (!overwrite) {
    try {
      await access(path);
      const error = new Error(`File already exists: ${path}`) as Error & { code: string };
      error.code = "EEXIST";
      throw error;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  return path;
}

export async function writeManifestJson(composition: Composition, outputPath: string, overwrite = false): Promise<string> {
  return writeJson(outputPath, exportManifestJson(composition), overwrite);
}

export async function writeClipReport(composition: Composition, outputPath: string, overwrite = false): Promise<string> {
  return writeJson(outputPath, exportClipReport(composition), overwrite);
}

export async function writeTimecodeLog(composition: Composition, outputPath: string, overwrite = false): Promise<string> {
  return writeJson(outputPath, exportTimecodeLog(composition), overwrite);
}
