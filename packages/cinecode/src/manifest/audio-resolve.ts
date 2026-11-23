import { resolve } from "node:path";
import type { AudioBuffer } from "../audio/types.js";
import type { AudioDef, SoundContext } from "../core/define/definitions.js";
import { createError, ErrorCode } from "../errors/index.js";
import { loadModuleFile } from "./loader.js";
import { resolveMediaFilePath } from "../media/paths.js";
import { toSeconds, findEntry, type ManifestProject } from "./index.js";

export function isAudioBuffer(value: unknown): value is AudioBuffer {
  return !!value && typeof value === "object" && "data" in (value as object) && "sampleRate" in (value as object);
}

export function renderSoundDef(
  def: { name?: string; duration?: number; generate: (ctx: SoundContext, params: unknown) => void },
  context: { sampleRate: number; channels: 1 | 2; duration: number; gain: number; seed: number; id: string },
): AudioBuffer {
  const { sampleRate, channels, duration, gain, seed, id } = context;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw createError(ErrorCode.CC5002, { name: def.name ?? id, reason: `duration must be a positive number, got ${duration}` });
  }
  if (def.duration !== undefined && Math.abs(def.duration - duration) > 0.001) {
    throw createError(ErrorCode.CC5002, { name: def.name ?? id, reason: `sound definition declared duration ${def.duration}s cannot match requested duration ${duration}s` });
  }
  const length = Math.round(sampleRate * duration);
  const data = new Float32Array(length * channels);
  const soundContext: SoundContext = {
    sampleRate,
    channels,
    duration,
    gain,
    seed,
    id,
    startSample: 0,
    lengthSamples: length,
    write: (sampleIndex: number, left: number, right?: number): void => {
      if (sampleIndex < 0 || sampleIndex >= length) return;
      if (channels === 1) {
        data[sampleIndex] = left * gain;
      } else {
        data[sampleIndex * 2] = left * gain;
        data[sampleIndex * 2 + 1] = (right ?? left) * gain;
      }
    },
  };
  try {
    def.generate(soundContext, {});
  } catch (error) {
    throw createError(ErrorCode.CC5002, { name: def.name ?? id, reason: error instanceof Error ? error.message : String(error) }, { cause: error });
  }
  return { sampleRate, channels, length, data };
}

export async function evaluateAudio(
  raw: unknown,
  context: { sampleRate: number; channels: 1 | 2; duration: number; gain: number; seed: number; id: string },
): Promise<AudioBuffer | null> {
  if (!raw) return null;
  if (isAudioBuffer(raw)) return raw;
  if (typeof raw === "object" && (raw as AudioDef).kind === "audio") return await (raw as AudioDef).build(context);
  if (typeof raw === "function") return (await (raw as (ctx: unknown) => unknown)(context)) as AudioBuffer;
  if (typeof raw === "object" && (raw as { kind?: string }).kind === "sound") {
    return renderSoundDef(raw as { name?: string; duration?: number; generate: (ctx: SoundContext, params: unknown) => void }, context);
  }
  return null;
}

export async function resolveAudioBuffer(
  project: ManifestProject,
  audioId: string,
): Promise<AudioBuffer> {
  const entry = findEntry(project.manifest.audio, audioId, "audio");
  const sampleRate = entry.sampleRate ?? project.config.audio?.sampleRate ?? 48000;
  const channels = (entry.channels ?? project.config.audio?.channels ?? 2) as 1 | 2;
  const gain = entry.gain ?? 1;
  const fps = project.config.video?.fps ?? 30;
  const duration = toSeconds(entry.duration, fps) ?? toSeconds(project.config.video?.defaultDuration, fps) ?? 5;

  if (entry.file) {
    const manifestDir = resolve(project.entryPath, "..");
    const resolved = resolve(manifestDir, entry.file);
    const raw = project.moduleCache?.get(resolved) ?? project.moduleCache?.get(entry.file) ?? (await loadModuleFile<unknown>(resolved, manifestDir, {}));
    const built = await evaluateAudio(raw, { sampleRate, channels, duration, gain, seed: 0, id: entry.id });
    if (built) return built;
  }

  if (entry.src) {
    const { decodeAudioFile } = await import("../audio/decode.js");
    const { createMediaCache } = await import("../media/cache.js");
    const cache = createMediaCache(resolve(project.rootDir, project.config.cacheDir ?? ".cinecode/cache", "media"));
    await cache.initialize();
    const mediaPath = resolveMediaFilePath(entry.src, project.rootDir, project.config);
    const decoded = await decodeAudioFile(mediaPath, { cache, targetSampleRate: sampleRate, targetChannels: channels });
    return decoded.buffer;
  }

  throw createError(ErrorCode.CC3008, { path: `audio:${audioId}`, expected: '"file" or "src"' });
}
