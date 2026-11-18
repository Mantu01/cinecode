import type { AudioBuffer } from "../audio/types.js";
import type { TtsClip } from "../core/types/clips.js";
import { createEdgeTtsEngine } from "./edge.js";
import { createSystemTtsEngine } from "./system.js";
import type { TtsEngine, TtsOptions } from "./engine.js";
import { isSsml } from "./ssml-parser.js";
import { synthesizeSsml } from "./ssml-speech.js";

export type TtsEngineName = "edge" | "system";

const synthesisCache = new Map<string, AudioBuffer>();

export function createTtsEngine(name: TtsEngineName = "system"): TtsEngine {
  return name === "edge" ? createEdgeTtsEngine() : createSystemTtsEngine();
}

export function clearTtsCache(): void {
  synthesisCache.clear();
}

export async function synthesizeTts(clip: TtsClip): Promise<AudioBuffer> {
  const engineName: TtsEngineName = clip.engine ?? "system";
  const key = `${engineName}|${clip.voice ?? ""}|${clip.speed ?? 1}|${clip.pitch ?? 0}|${clip.language ?? "en-US"}|${clip.text}`;
  const cached = synthesisCache.get(key);
  if (cached) return cached;

  const options: TtsOptions = {
    speed: clip.speed,
    pitch: clip.pitch,
    language: clip.language,
    voice: clip.voice,
    volume: clip.volume,
  };

  let engine = createTtsEngine(engineName);
  let buffer: AudioBuffer;
  try {
    buffer = isSsml(clip.text)
      ? (await synthesizeSsml(clip.text, engine, options)).buffer
      : await engine.synthesize(clip.text, options);
  } catch (error) {
    if (engineName === "edge") {
      engine = createSystemTtsEngine();
      buffer = isSsml(clip.text)
        ? (await synthesizeSsml(clip.text, engine, options)).buffer
        : await engine.synthesize(clip.text, options);
    } else {
      throw error;
    }
  }

  if (synthesisCache.size >= 64) synthesisCache.clear();
  synthesisCache.set(key, buffer);
  return buffer;
}
