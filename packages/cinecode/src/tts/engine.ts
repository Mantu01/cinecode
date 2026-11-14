import type { AudioBuffer } from "../audio/types.js";

export interface TtsOptions {
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly language?: string;
  readonly voice?: string;
}

export interface TtsVoice {
  readonly name: string;
  readonly language: string;
  readonly gender?: "male" | "female";
}

export interface TtsEngine {
  readonly name: string;
  synthesize(text: string, options: TtsOptions): Promise<AudioBuffer>;
  getVoices(): Promise<readonly TtsVoice[]>;
  readonly available: boolean;
}
