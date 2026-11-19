import type { AudioBuffer } from "../audio/types.js";
import { createError, ErrorCode } from "../errors/index.js";
import type { TtsEngine, TtsOptions, TtsVoice } from "./engine.js";
import { createSystemTtsEngine } from "./system.js";

export type VoiceProviderName = "system" | string;

export interface VoiceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly provider: VoiceProviderName;
  readonly language: string;
  readonly locale: string;
  readonly gender?: "male" | "female" | "neutral";
  readonly styles?: readonly string[];
  readonly sampleRateHz: number;
  readonly custom?: boolean;
}

export interface VoiceSynthesisOptions extends TtsOptions {
  readonly provider?: VoiceProviderName;
  readonly style?: string;
  readonly model?: string;
}

export interface VoiceProvider {
  readonly name: VoiceProviderName;
  readonly available: boolean;
  listVoices(): Promise<readonly VoiceDescriptor[]>;
  synthesize(text: string, voiceId: string, options: VoiceSynthesisOptions): Promise<AudioBuffer>;
}

export interface CustomVoiceProfile {
  readonly descriptor: Omit<VoiceDescriptor, "custom">;
  readonly referenceAudioPath?: string;
  readonly embedding?: readonly number[];
}

export interface VoiceFilter {
  readonly language?: string;
  readonly provider?: VoiceProviderName;
  readonly search?: string;
  readonly styles?: readonly string[];
}

const DEFAULT_SAMPLE_RATE = 48000;

function toDescriptor(voice: TtsVoice, provider: VoiceProviderName): VoiceDescriptor {
  const locale = voice.language || "en-US";
  return {
    id: `${provider}:${voice.name}`,
    name: voice.name,
    provider,
    language: locale.split(/[-_]/)[0] ?? "en",
    locale,
    gender: voice.gender ?? "neutral",
    styles: [],
    sampleRateHz: DEFAULT_SAMPLE_RATE,
  };
}

function engineProvider(name: "system", engine: TtsEngine): VoiceProvider {
  return {
    name,
    get available(): boolean {
      return engine.available;
    },
    async listVoices(): Promise<readonly VoiceDescriptor[]> {
      const voices = await engine.getVoices().catch(() => []);
      return voices.map((voice) => toDescriptor(voice, name));
    },
    async synthesize(text: string, voiceId: string, options: VoiceSynthesisOptions): Promise<AudioBuffer> {
      return engine.synthesize(text, { ...options, voice: voiceId });
    },
  };
}

export class VoiceRegistry {
  private readonly providers = new Map<VoiceProviderName, VoiceProvider>();
  private readonly customVoices = new Map<string, CustomVoiceProfile>();

  constructor() {
    this.registerProvider(engineProvider("system", createSystemTtsEngine()));
  }

  registerProvider(provider: VoiceProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: VoiceProviderName): VoiceProvider | null {
    return this.providers.get(name) ?? null;
  }

  listProviders(): readonly VoiceProviderName[] {
    return [...this.providers.keys()];
  }

  registerCustomVoice(profile: CustomVoiceProfile): VoiceDescriptor {
    const descriptor: VoiceDescriptor = { ...profile.descriptor, custom: true };
    this.customVoices.set(descriptor.id, { ...profile, descriptor });
    return descriptor;
  }

  async listVoices(filter: VoiceFilter = {}): Promise<readonly VoiceDescriptor[]> {
    const voices: VoiceDescriptor[] = [...this.customVoices.values()].map((profile) => ({ ...profile.descriptor, custom: true }));
    for (const provider of this.providers.values()) {
      if (filter.provider && provider.name !== filter.provider) continue;
      if (!provider.available) continue;
      voices.push(...await provider.listVoices().catch(() => []));
    }
    const search = filter.search?.toLowerCase();
    return voices.filter((voice) => {
      if (filter.language && voice.language !== filter.language && voice.locale !== filter.language) return false;
      if (filter.styles && filter.styles.length > 0 && !filter.styles.some((style) => voice.styles?.includes(style))) return false;
      if (search && !`${voice.id} ${voice.name} ${voice.locale} ${(voice.styles ?? []).join(" ")}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  async findVoice(voiceId: string): Promise<VoiceDescriptor | null> {
    const direct = this.customVoices.get(voiceId);
    if (direct) return { ...direct.descriptor, custom: true };
    const voices = await this.listVoices({});
    return voices.find((voice) => voice.id === voiceId)
      ?? voices.find((voice) => voice.name.toLowerCase() === voiceId.toLowerCase())
      ?? null;
  }

  async synthesize(text: string, options: VoiceSynthesisOptions & { readonly voiceId?: string } = {}): Promise<AudioBuffer> {
    const voiceId = options.voiceId ?? options.voice;
    if (!voiceId) {
      throw createError(ErrorCode.CC5002, { name: "tts", reason: "A voice id or voice name is required for synthesis" });
    }
    const descriptor = await this.findVoice(voiceId);
    const providerName = options.provider ?? descriptor?.provider ?? "system";
    const provider = this.providers.get(providerName);
    if (!provider || !provider.available) {
      throw createError(ErrorCode.CC5401, { engine: providerName, reason: `Voice provider '${providerName}' is not available offline` });
    }
    const resolvedId = descriptor?.id ?? voiceId;
    return provider.synthesize(text, resolvedId, { ...options, voice: resolvedId });
  }
}

let registryInstance: VoiceRegistry | null = null;

export function getVoiceRegistry(): VoiceRegistry {
  if (!registryInstance) registryInstance = new VoiceRegistry();
  return registryInstance;
}

export function resetVoiceRegistry(): void {
  registryInstance = null;
}
