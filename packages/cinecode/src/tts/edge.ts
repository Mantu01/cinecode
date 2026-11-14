import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioBuffer } from "../audio/types.js";
import { decodeAudioFile } from "../audio/decode.js";
import type { TtsEngine, TtsOptions, TtsVoice } from "./engine.js";

interface EdgeVoiceLike {
  readonly ShortName?: string;
  readonly FriendlyName?: string;
  readonly Locale?: string;
  readonly Gender?: string;
}

interface EdgeTtsModule {
  readonly getVoices?: () => Promise<readonly EdgeVoiceLike[]>;
  readonly synthesize?: (text: string, options: Record<string, unknown>) => Promise<{ audio?: Buffer; buffer?: Buffer; data?: Buffer }>;
}

async function loadEdgeModule(): Promise<EdgeTtsModule | null> {
  try {
    const module = await import("edge-tts" as string) as EdgeTtsModule & { default?: EdgeTtsModule };
    return module.default ?? module;
  } catch {
    return null;
  }
}

export function createEdgeTtsEngine(): TtsEngine {
  let modulePromise: Promise<EdgeTtsModule | null> | null = null;
  const module = (): Promise<EdgeTtsModule | null> => {
    if (!modulePromise) modulePromise = loadEdgeModule();
    return modulePromise;
  };

  return {
    name: "edge",
    get available(): boolean {
      return true;
    },
    async synthesize(text: string, options: TtsOptions = {}): Promise<AudioBuffer> {
      const backend = await module();
      if (!backend?.synthesize) {
        throw new Error("The edge-tts backend is not installed. Install it with `pnpm i edge-tts` or use engine: \"system\".");
      }
      const voice = options.voice ?? "en-US-AriaNeural";
      const rate = `${Math.round(((options.speed ?? 1) - 1) * 100)}%`;
      const result = await backend.synthesize(text, { voice, rate, pitch: `${options.pitch ?? 0}Hz` });
      const buffer = result.audio ?? result.buffer ?? result.data;
      if (!buffer) throw new Error("edge-tts returned no audio data.");
      const directory = await mkdtemp(join(tmpdir(), "cinecode-edge-tts-"));
      const outputPath = join(directory, "speech.mp3");
      try {
        await writeFile(outputPath, buffer);
        const decoded = await decodeAudioFile(outputPath, { targetSampleRate: 48000, targetChannels: 1 });
        return decoded.buffer;
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async getVoices(): Promise<readonly TtsVoice[]> {
      const backend = await module();
      if (!backend?.getVoices) return [];
      const voices = await backend.getVoices();
      return voices.map((voice) => ({
        name: voice.FriendlyName ?? voice.ShortName ?? "unknown",
        language: voice.Locale ?? "en-US",
        gender: voice.Gender?.toLowerCase() === "male" ? "male" : voice.Gender?.toLowerCase() === "female" ? "female" : undefined,
      }));
    },
  };
}
