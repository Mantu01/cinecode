import type { AudioBuffer } from "../audio/types.js";
import type { TtsClip } from "../core/types/clips.js";
import { createSystemTtsEngine } from "./system.js";
import type { TtsEngine, TtsOptions } from "./engine.js";
import { isSsml } from "./ssml-parser.js";
import { synthesizeSsml } from "./ssml-speech.js";
import { createError, ErrorCode } from "../errors/index.js";

export type TtsEngineName = "system" | string;

const synthesisCache = new Map<string, AudioBuffer>();

export function createTtsEngine(name: TtsEngineName = "system"): TtsEngine {
  if (name === "system") {
    return createSystemTtsEngine();
  }
  throw createError(ErrorCode.CC5401, {
    engine: name,
    reason: `Engine '${name}' is not available offline in core package.`,
  });
}

export function clearTtsCache(): void {
  synthesisCache.clear();
}

export async function synthesizeTts(clip: TtsClip): Promise<AudioBuffer> {
  const engineName: TtsEngineName = clip.engine ?? "system";
  if (engineName !== "system") {
    throw createError(ErrorCode.CC5401, {
      engine: engineName,
      reason: `Engine '${engineName}' is not available offline in core package.`,
    });
  }

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

  const engine = createSystemTtsEngine();
  const buffer = isSsml(clip.text)
    ? (await synthesizeSsml(clip.text, engine, options)).buffer
    : await engine.synthesize(clip.text, options);

  if (synthesisCache.size >= 64) synthesisCache.clear();
  synthesisCache.set(key, buffer);
  return buffer;
}
