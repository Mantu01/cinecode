import { spawnSync } from "node:child_process";
import type { CinecodeConfig } from "../../../core/types/index.js";
import type { BinaryResolution } from "../../../binary/resolver.js";
import type { HealthSection } from "./types.js";

const cachedEncoders = new Map<string, Set<string>>();

export function resetEncoderCache(): void {
  cachedEncoders.clear();
}

export function probeAvailableEncoders(ffmpegPath: string): Set<string> {
  const cached = cachedEncoders.get(ffmpegPath);
  if (cached) return cached;
  const set = new Set<string>();
  try {
    const res = spawnSync(ffmpegPath, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const lines = (res.stdout ?? "").split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*[VAFS.]{6}\s+(\S+)/.exec(line);
      if (match?.[1]) set.add(match[1]);
    }
  } catch {
    return set;
  }
  cachedEncoders.set(ffmpegPath, set);
  return set;
}

export function hasCodecEncoder(codec: string, encoders: Set<string>): boolean {
  switch (codec.toLowerCase()) {
    case "h264":
      return encoders.has("libx264") || encoders.has("libx264rgb") || encoders.has("h264_nvenc") ||
        encoders.has("h264_amf") || encoders.has("h264_qsv") || encoders.has("h264_videotoolbox") ||
        encoders.has("nvenc") || encoders.has("nvenc_h264");
    case "hevc":
    case "h265":
      return encoders.has("libx265") || encoders.has("hevc_nvenc") || encoders.has("hevc_amf") ||
        encoders.has("hevc_qsv") || encoders.has("hevc_videotoolbox") || encoders.has("nvenc_hevc");
    case "av1":
      return encoders.has("libsvtav1") || encoders.has("libaom-av1") || encoders.has("librav1e") ||
        encoders.has("av1_nvenc") || encoders.has("av1_amf") || encoders.has("av1_qsv");
    case "vp9":
      return encoders.has("libvpx-vp9") || encoders.has("vp9_vaapi") || encoders.has("vp9_qsv");
    case "prores":
      return encoders.has("prores_ks") || encoders.has("prores") || encoders.has("prores_videotoolbox") || encoders.has("prores_aw");
    case "ffv1":
      return encoders.has("ffv1");
    default:
      return encoders.has(codec);
  }
}

export interface EncodersHealth {
  readonly section: HealthSection;
  readonly h264: boolean;
  readonly hevc: boolean;
  readonly av1: boolean;
  readonly vp9: boolean;
}

export function collectEncodersHealth(
  ffmpeg: BinaryResolution | null,
  config: CinecodeConfig | undefined,
  isProject: boolean,
  requiredCodec: string | undefined,
  issues: string[],
): EncodersHealth {
  const availableEncoders = ffmpeg ? probeAvailableEncoders(ffmpeg.path) : new Set<string>();
  const flags = {
    h264: hasCodecEncoder("h264", availableEncoders),
    hevc: hasCodecEncoder("hevc", availableEncoders),
    av1: hasCodecEncoder("av1", availableEncoders),
    vp9: hasCodecEncoder("vp9", availableEncoders),
  };
  try {
    const requiredCodecs: string[] = [];
    if (requiredCodec) {
      requiredCodecs.push(requiredCodec);
    } else if (config?.render?.codec) {
      requiredCodecs.push(config.render.codec);
    } else if (isProject) {
      requiredCodecs.push("h264");
    }

    const missingRequired = requiredCodecs.filter((codec) => !hasCodecEncoder(codec, availableEncoders));
    if (missingRequired.length > 0) {
      for (const m of missingRequired) {
        issues.push(`Required video encoder for "${m}" is not available in ffmpeg build`);
      }
      return {
        ...flags,
        section: {
          name: "Encoders",
          status: "FAIL",
          message: `Missing required encoder(s): ${missingRequired.join(", ")}`,
          details: {
            available: Array.from(availableEncoders),
            requiredByProject: requiredCodecs,
            missingRequired,
          },
          fixHint: `Install an ffmpeg build that includes support for ${missingRequired.join(", ")}`,
        },
      };
    }

    const summaryList = ["libx264", "libx265", "libaom-av1", "libvpx-vp9", "prores_ks", "ffv1"].filter((e) =>
      availableEncoders.has(e),
    );
    return {
      ...flags,
      section: {
        name: "Encoders",
        status: "PASS",
        message: requiredCodecs.length > 0
          ? `Required encoder for ${requiredCodecs.join(", ")} available (found ${summaryList.join(", ") || "compatible encoder"})`
          : `Available encoders: ${summaryList.join(", ") || "probed"}`,
        details: {
          available: Array.from(availableEncoders),
          requiredByProject: requiredCodecs,
          missingRequired: [],
        },
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...flags,
      section: {
        name: "Encoders",
        status: "FAIL",
        message: `Encoder probe failed: ${msg}`,
        fixHint: "Check ffmpeg installation",
      },
    };
  }
}
