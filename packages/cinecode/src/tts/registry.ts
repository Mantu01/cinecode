import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioBuffer } from "../audio/types.js";
import { decodeAudioFile } from "../audio/decode.js";
import type { TtsEngine, TtsOptions, TtsVoice } from "./engine.js";
import { createEdgeTtsEngine } from "./edge.js";
import { createSystemTtsEngine } from "./system.js";

export type VoiceProviderName = "edge" | "system" | "azure" | "elevenlabs" | "openai" | "coqui";

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

function engineProvider(name: "edge" | "system", engine: TtsEngine): VoiceProvider {
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

async function decodeAudioBytes(bytes: Buffer, extension: string): Promise<AudioBuffer> {
  const directory = await mkdtemp(join(tmpdir(), "cinecode-voice-"));
  const path = join(directory, `speech.${extension}`);
  try {
    await writeFile(path, bytes);
    const decoded = await decodeAudioFile(path, { targetSampleRate: DEFAULT_SAMPLE_RATE, targetChannels: 1 });
    return decoded.buffer;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface CloudProviderConfig {
  readonly name: VoiceProviderName;
  readonly apiKeyEnv: string;
  readonly endpointEnv?: string;
  readonly defaultEndpoint?: string;
  readonly voices: readonly VoiceDescriptor[];
  buildRequest(
    text: string,
    voiceId: string,
    options: VoiceSynthesisOptions,
    credentials: { readonly apiKey: string; readonly endpoint: string },
  ): { readonly url: string; readonly init: RequestInit; readonly extension: string };
}

function createCloudProvider(config: CloudProviderConfig): VoiceProvider {
  const apiKey = process.env[config.apiKeyEnv] ?? "";
  const endpoint = (config.endpointEnv ? process.env[config.endpointEnv] : undefined) ?? config.defaultEndpoint ?? "";
  return {
    name: config.name,
    available: apiKey.length > 0 || config.name === "coqui",
    async listVoices(): Promise<readonly VoiceDescriptor[]> {
      return config.voices;
    },
    async synthesize(text: string, voiceId: string, options: VoiceSynthesisOptions): Promise<AudioBuffer> {
      if (!config.name.startsWith("co") && apiKey.length === 0) {
        throw new Error(`CC5401: ${config.name} requires the ${config.apiKeyEnv} environment variable`);
      }
      const request = config.buildRequest(text, voiceId, options, { apiKey, endpoint });
      const response = await fetch(request.url, request.init);
      if (!response.ok) {
        throw new Error(`CC5402: ${config.name} synthesis failed with HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return decodeAudioBytes(bytes, request.extension);
    },
  };
}

const OPENAI_VOICES: readonly VoiceDescriptor[] = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((voice) => ({
  id: `openai:${voice}`,
  name: voice,
  provider: "openai",
  language: "en",
  locale: "en-US",
  gender: "neutral",
  styles: ["neutral", "cheerful", "empathetic"],
  sampleRateHz: 24000,
}));

const ELEVENLABS_VOICES: readonly VoiceDescriptor[] = [
  { id: "elevenlabs:21m00Tcm4TlvDq8ikWAM", name: "Rachel", provider: "elevenlabs", language: "en", locale: "en-US", gender: "female", styles: ["narration", "cheerful"], sampleRateHz: 44100 },
  { id: "elevenlabs:AZnzlk1XvdvUeBnXmlld", name: "Domi", provider: "elevenlabs", language: "en", locale: "en-US", gender: "female", styles: ["newscast"], sampleRateHz: 44100 },
  { id: "elevenlabs:EXAVITQu4vr4xnSDxMaL", name: "Bella", provider: "elevenlabs", language: "en", locale: "en-US", gender: "female", styles: ["soft"], sampleRateHz: 44100 },
  { id: "elevenlabs:ErXwobaYiN019PkySvjV", name: "Antoni", provider: "elevenlabs", language: "en", locale: "en-US", gender: "male", styles: ["narration"], sampleRateHz: 44100 },
];

const AZURE_VOICES: readonly VoiceDescriptor[] = [
  { id: "azure:en-US-JennyNeural", name: "Jenny", provider: "azure", language: "en", locale: "en-US", gender: "female", styles: ["cheerful", "empathetic", "newscast"], sampleRateHz: 24000 },
  { id: "azure:en-US-GuyNeural", name: "Guy", provider: "azure", language: "en", locale: "en-US", gender: "male", styles: ["newscast"], sampleRateHz: 24000 },
  { id: "azure:en-GB-SoniaNeural", name: "Sonia", provider: "azure", language: "en", locale: "en-GB", gender: "female", styles: ["cheerful"], sampleRateHz: 24000 },
];

const COQUI_VOICES: readonly VoiceDescriptor[] = [
  { id: "coqui:default", name: "Coqui", provider: "coqui", language: "en", locale: "en-US", gender: "neutral", styles: [], sampleRateHz: 22050 },
];

export const BUILTIN_CLOUD_PROVIDERS: readonly VoiceProvider[] = [
  createCloudProvider({
    name: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultEndpoint: "https://api.openai.com/v1/audio/speech",
    voices: OPENAI_VOICES,
    buildRequest(text, voiceId, options, credentials) {
      return {
        url: credentials.endpoint,
        extension: "wav",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` },
          body: JSON.stringify({
            model: options.model ?? "gpt-4o-mini-tts",
            voice: voiceId.replace(/^openai:/, ""),
            input: text,
            response_format: "wav",
            speed: options.speed ?? 1,
          }),
        },
      };
    },
  }),
  createCloudProvider({
    name: "elevenlabs",
    apiKeyEnv: "ELEVENLABS_API_KEY",
    defaultEndpoint: "https://api.elevenlabs.io/v1/text-to-speech",
    voices: ELEVENLABS_VOICES,
    buildRequest(text, voiceId, options, credentials) {
      const id = voiceId.replace(/^elevenlabs:/, "");
      return {
        url: `${credentials.endpoint}/${encodeURIComponent(id)}`,
        extension: "mp3",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": credentials.apiKey },
          body: JSON.stringify({
            text,
            model_id: options.model ?? "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: options.style ? 0.5 : 0 },
          }),
        },
      };
    },
  }),
  createCloudProvider({
    name: "azure",
    apiKeyEnv: "AZURE_SPEECH_KEY",
    endpointEnv: "AZURE_SPEECH_ENDPOINT",
    defaultEndpoint: "https://eastus.tts.speech.microsoft.com",
    voices: AZURE_VOICES,
    buildRequest(text, voiceId, options, credentials) {
      const voiceName = voiceId.replace(/^azure:/, "");
      const locale = AZURE_VOICES.find((voice) => voice.id === voiceId)?.locale ?? "en-US";
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voiceName}"><prosody rate="${Math.round((options.speed ?? 1) * 100)}%">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</prosody></voice></speak>`;
      return {
        url: `${credentials.endpoint.replace(/\/$/, "")}/cognitiveservices/v1`,
        extension: "wav",
        init: {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": credentials.apiKey,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
          },
          body: ssml,
        },
      };
    },
  }),
  createCloudProvider({
    name: "coqui",
    apiKeyEnv: "COQUI_API_KEY",
    endpointEnv: "COQUI_TTS_URL",
    defaultEndpoint: "http://localhost:5002",
    voices: COQUI_VOICES,
    buildRequest(text, voiceId, options, credentials) {
      return {
        url: `${credentials.endpoint.replace(/\/$/, "")}/api/tts`,
        extension: "wav",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            speaker_id: options.voice ?? voiceId.replace(/^coqui:/, ""),
            style_wav: options.style ?? "",
          }),
        },
      };
    },
  }),
];

export class VoiceRegistry {
  private readonly providers = new Map<VoiceProviderName, VoiceProvider>();
  private readonly customVoices = new Map<string, CustomVoiceProfile>();

  constructor() {
    this.registerProvider(engineProvider("edge", createEdgeTtsEngine()));
    this.registerProvider(engineProvider("system", createSystemTtsEngine()));
    for (const provider of BUILTIN_CLOUD_PROVIDERS) this.registerProvider(provider);
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
    if (!voiceId) throw new Error("CC5403: A voice id or voice name is required for synthesis");
    const descriptor = await this.findVoice(voiceId);
    const providerName = options.provider ?? descriptor?.provider;
    if (!providerName) throw new Error(`CC5404: Unknown voice: ${voiceId}`);
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`CC5404: Unknown voice provider: ${providerName}`);
    if (!provider.available) throw new Error(`CC5405: Voice provider '${providerName}' is not available in this environment`);
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
