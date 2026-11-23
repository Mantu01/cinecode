import type { AudioMuxCodec } from "../../audio/muxer.js";
import type { GifDitherMode } from "../../core/output-plan.js";
import type { FullPlatformPreset } from "../../encoder/platform-presets.js";
import type { CinecodeConfig } from "../../core/types/index.js";
import type { PrecedenceFlags, ResolvedField } from "./precedence-types.js";

export function field<T>(
  flagVal: { value: T; source: string } | undefined,
  selVal: { value: T; source: string } | undefined,
  presetVal: { value: T; source: string } | undefined,
  cfgVal: { value: T; key: string } | undefined,
  defVal: T,
): ResolvedField<T>;
export function field<T>(
  flagVal: { value: T; source: string } | undefined,
  selVal: { value: T; source: string } | undefined,
  cfgVal: { value: T; key: string } | undefined,
  defVal: T,
): ResolvedField<T>;
export function field<T>(
  flagVal: { value: T; source: string } | undefined,
  selVal: { value: T; source: string } | undefined,
  arg3: unknown,
  arg4?: unknown,
  arg5?: unknown,
): ResolvedField<T> {
  if (flagVal !== undefined) return { value: flagVal.value, origin: "flag", source: flagVal.source, originLabel: "flag" };
  if (selVal !== undefined) return { value: selVal.value, origin: "selection", source: selVal.source, originLabel: "selection" };
  if (arguments.length === 5) {
    const presetVal = arg3 as { value: T; source: string } | undefined;
    const cfgVal = arg4 as { value: T; key: string } | undefined;
    const defVal = arg5 as T;
    if (presetVal !== undefined) return { value: presetVal.value, origin: "preset", source: presetVal.source, originLabel: presetVal.source };
    if (cfgVal !== undefined) return { value: cfgVal.value, origin: "config", source: cfgVal.key, originLabel: cfgVal.key };
    return { value: defVal, origin: "default", source: "default", originLabel: "default" };
  }
  const cfgVal = arg3 as { value: T; key: string } | undefined;
  const defVal = arg4 as T;
  if (cfgVal !== undefined) return { value: cfgVal.value, origin: "config", source: cfgVal.key, originLabel: cfgVal.key };
  return { value: defVal, origin: "default", source: "default", originLabel: "default" };
}

export function resolveAuxiliaryParameters(
  flags: PrecedenceFlags,
  config: CinecodeConfig | undefined,
  explicit: ReadonlySet<string>,
  preset: FullPlatformPreset | undefined,
  presetSource: string,
) {
  // Audio Codec
  const flagAudioCodec = flags.audioCodec !== undefined ? { value: flags.audioCodec, source: "--audio-codec" } : undefined;
  const presetAudioCodec = preset?.audio?.codec && preset.audio.codec !== "none" ? { value: preset.audio.codec as AudioMuxCodec, source: presetSource } : undefined;
  const cfgAudioCodec = explicit.has("render.audioCodec") && config?.render?.audioCodec !== undefined
    ? { value: config.render.audioCodec as AudioMuxCodec, key: "render.audioCodec" }
    : undefined;
  const audioCodec = field(flagAudioCodec, undefined, presetAudioCodec, cfgAudioCodec, undefined as AudioMuxCodec | undefined);

  // Audio Bitrate
  const flagAudioBitrate = flags.audioBitrate !== undefined ? { value: flags.audioBitrate, source: "--audio-bitrate" } : undefined;
  const presetAudioBitrate = preset?.audio?.bitrateKbps ? { value: preset.audio.bitrateKbps, source: presetSource } : undefined;
  const cfgAudioBitrate = explicit.has("render.audioBitrate") && config?.render?.audioBitrate !== undefined
    ? { value: config.render.audioBitrate, key: "render.audioBitrate" }
    : undefined;
  const audioBitrate = field(flagAudioBitrate, undefined, presetAudioBitrate, cfgAudioBitrate, undefined as number | undefined);

  // GIF Quality
  const flagGifQuality = flags.gifQuality !== undefined ? { value: flags.gifQuality, source: "--gif-quality" } : undefined;
  const cfgGifQuality = explicit.has("render.gifQuality") && config?.render?.gifQuality !== undefined
    ? { value: config.render.gifQuality, key: "render.gifQuality" }
    : undefined;
  const gifQuality = field(flagGifQuality, undefined, cfgGifQuality, 8);

  // GIF Dither
  const flagGifDither = flags.gifDither !== undefined ? { value: flags.gifDither, source: "--gif-dither" } : undefined;
  const cfgGifDither = explicit.has("render.gifDither") && config?.render?.gifDither !== undefined
    ? { value: config.render.gifDither as GifDitherMode, key: "render.gifDither" }
    : undefined;
  const gifDither = field(flagGifDither, undefined, cfgGifDither, "floyd-steinberg" as GifDitherMode);

  // GIF Max Frames
  const flagGifMaxFrames = flags.gifMaxFrames !== undefined ? { value: flags.gifMaxFrames, source: "--gif-max-frames" } : undefined;
  const cfgGifMaxFrames = explicit.has("render.gifMaxFrames") && config?.render?.gifMaxFrames !== undefined
    ? { value: config.render.gifMaxFrames, key: "render.gifMaxFrames" }
    : undefined;
  const gifMaxFrames = field(flagGifMaxFrames, undefined, cfgGifMaxFrames, undefined as number | undefined);

  // Seed
  const flagSeed = flags.seed !== undefined ? { value: flags.seed, source: "--seed" } : undefined;
  const cfgSeed = explicit.has("render.seed") && config?.render?.seed !== undefined
    ? { value: typeof config.render.seed === "number" ? config.render.seed : Number(config.render.seed), key: "render.seed" }
    : undefined;
  const seed = field(flagSeed, undefined, cfgSeed, undefined as number | undefined);

  // Effects
  const flagEffects = flags.effects !== undefined
    ? {
        value: typeof flags.effects === "string" ? flags.effects.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : flags.effects,
        source: "--effects",
      }
    : undefined;
  const cfgEffects = explicit.has("render.effects") && config?.render?.effects !== undefined
    ? { value: config.render.effects, key: "render.effects" }
    : undefined;
  const effects = field(flagEffects, undefined, cfgEffects, undefined as readonly string[] | undefined);

  // No-Effects
  const flagNoEffects = flags.noEffects !== undefined ? { value: flags.noEffects, source: "--no-effects" } : undefined;
  const cfgNoEffects = explicit.has("render.noEffects") && config?.render?.noEffects !== undefined
    ? { value: config.render.noEffects, key: "render.noEffects" }
    : undefined;
  const noEffects = field(flagNoEffects, undefined, cfgNoEffects, false);

  // Strict Fonts
  const flagStrictFonts = flags.strictFonts !== undefined
    ? { value: flags.strictFonts, source: "--strict" }
    : flags.strict !== undefined
      ? { value: flags.strict, source: "--strict" }
      : undefined;
  const cfgStrictFonts = explicit.has("render.strictFonts") && config?.render?.strictFonts !== undefined
    ? { value: config.render.strictFonts, key: "render.strictFonts" }
    : undefined;
  const strictFonts = field(flagStrictFonts, undefined, cfgStrictFonts, false);

  // Frame Error Policy
  const flagFrameErrorPolicy = flags.frameErrorPolicy !== undefined
    ? { value: flags.frameErrorPolicy, source: "--frame-error-policy" }
    : undefined;
  const cfgFrameErrorPolicy = explicit.has("render.frameErrorPolicy") && (config?.render as { frameErrorPolicy?: "placeholder" | "repeat-previous" | "abort" } | undefined)?.frameErrorPolicy !== undefined
    ? { value: (config!.render as { frameErrorPolicy: "placeholder" | "repeat-previous" | "abort" }).frameErrorPolicy, key: "render.frameErrorPolicy" }
    : undefined;
  const frameErrorPolicy = field(flagFrameErrorPolicy, undefined, cfgFrameErrorPolicy, "placeholder" as "placeholder" | "repeat-previous" | "abort");

  return { audioCodec, audioBitrate, gifQuality, gifDither, gifMaxFrames, seed, effects, noEffects, strictFonts, frameErrorPolicy };
}
