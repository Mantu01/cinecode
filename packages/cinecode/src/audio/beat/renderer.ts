import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Composition, AudioClip, SoundClip } from "../../core/types/index.js";
import { decodeAudioFile } from "../decode.js";
import type { MediaCache } from "../../media/cache.js";
import { detectOnsets } from "./onset.js";
import { estimateTempo } from "./tempo.js";
import { BeatTracker } from "./tracker.js";

export interface BeatInfo {
  readonly bpm: number;
  readonly beats: readonly { readonly time: number; readonly intensity: number }[];
  readonly confidence: number;
  getPhaseAt(time: number): number;
  isOnBeatAt(time: number, toleranceMs?: number): boolean;
}

const analysisCache = new Map<string, BeatInfo>();

export async function renderBeatInfo(
  clips: readonly (AudioClip | SoundClip)[],
  composition: Composition,
  cache?: MediaCache,
): Promise<BeatInfo> {
  const key = `${composition.name}:${clips.length}:${clips.map((clip) => "src" in clip ? clip.src : clip.ref).join(",")}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;

  const onsets = [];
  const sampleRate = composition.audio?.sampleRate ?? 48000;
  for (const clip of clips) {
    if (!("src" in clip) || typeof clip.src !== "string" || clip.src.length === 0) continue;
    try {
      const decoded = await decodeAudioFile(clip.src, { cache, targetSampleRate: sampleRate, targetChannels: 1 });
      onsets.push(...detectOnsets(decoded.buffer));
    } catch {
      // Note: skip unreadable audio clip during onset detection
      void 0;
    }
  }

  const tempo = estimateTempo(onsets, sampleRate);
  const tracker = new BeatTracker(tempo);
  const info: BeatInfo = {
    bpm: tempo.bpm,
    beats: tempo.beats,
    confidence: tempo.confidence,
    getPhaseAt: (time) => tracker.getCurrentBeatPhase(time),
    isOnBeatAt: (time, toleranceMs) => tracker.isOnBeat(time, toleranceMs),
  };
  analysisCache.set(key, info);
  return info;
}

export function clearBeatCache(): void {
  analysisCache.clear();
}

export interface BeatMarkerStyle {
  readonly color?: string;
  readonly downbeatColor?: string;
  readonly height?: number;
  readonly y?: number;
  readonly playheadTime?: number;
}

export function drawBeatMarkers(
  ctx: SKRSContext2D,
  beatInfo: BeatInfo,
  width: number,
  height: number,
  style: BeatMarkerStyle = {},
): void {
  const duration = beatInfo.beats.length > 0 ? Math.max(...beatInfo.beats.map((beat) => beat.time)) + 0.01 : 1;
  const markerHeight = style.height ?? 18;
  const y = style.y ?? height - markerHeight - 8;
  for (let index = 0; index < beatInfo.beats.length; index += 1) {
    const beat = beatInfo.beats[index]!;
    const x = (beat.time / duration) * width;
    const downbeat = index % 4 === 0;
    ctx.save();
    ctx.fillStyle = downbeat ? (style.downbeatColor ?? "#f5b544") : (style.color ?? "#8a8781");
    ctx.globalAlpha = 0.35 + Math.min(0.65, beat.intensity / 255 + 0.35);
    ctx.fillRect(x, y, downbeat ? 3 : 1.5, markerHeight);
    ctx.restore();
  }
  if (style.playheadTime !== undefined) {
    const x = (style.playheadTime / duration) * width;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + markerHeight + 4);
    ctx.stroke();
    ctx.restore();
  }
}
