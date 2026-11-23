import { resolveBinary, type BinaryResolution } from "../../../binary/resolver.js";
import type { CinecodeConfig } from "../../../core/types/index.js";
import type { HealthSection } from "./types.js";

export interface BinariesHealth {
  readonly section: HealthSection;
  readonly ffmpeg: BinaryResolution | null;
  readonly ffprobe: BinaryResolution | null;
}

export function collectBinariesHealth(
  config: CinecodeConfig | undefined,
  projectRoot: string,
  issues: string[],
): BinariesHealth {
  try {
    const binariesConfig = { ...config?.binaries, root: projectRoot };
    const ffmpeg = resolveBinary("ffmpeg", binariesConfig, { probeVersion: true });
    const ffprobe = resolveBinary("ffprobe", binariesConfig, { probeVersion: true });
    const ffmpegOk = ffmpeg.version !== "unknown" && ffmpeg.version !== "not found";
    const ffprobeOk = ffprobe.version !== "unknown" && ffprobe.version !== "not found";

    if (!ffmpegOk) issues.push(`FFmpeg binary not available at ${ffmpeg.path}`);
    if (!ffprobeOk) issues.push(`FFprobe binary not available at ${ffprobe.path}`);

    const ok = ffmpegOk && ffprobeOk;
    return {
      ffmpeg,
      ffprobe,
      section: {
        name: "Binaries",
        status: ok ? "PASS" : "FAIL",
        message: `ffmpeg ${ffmpeg.version} (${ffmpeg.provenance}) at ${ffmpeg.path}, ffprobe ${ffprobe.version} (${ffprobe.provenance}) at ${ffprobe.path}`,
        details: { ffmpeg, ffprobe },
        fixHint: ok ? undefined : "Install ffmpeg and ffprobe, or specify explicit paths in cinecode.config.ts",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Binary resolution failed: ${msg}`);
    return {
      ffmpeg: null,
      ffprobe: null,
      section: {
        name: "Binaries",
        status: "FAIL",
        message: `Binary check failed: ${msg}`,
        fixHint: "Ensure ffmpeg is installed and available in PATH or cinecode.config.ts",
      },
    };
  }
}
