import { cpus, totalmem, freemem, platform, arch } from "node:os";
import { resolve } from "node:path";
import { statfs, access, constants } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { checkRuntime } from "../loader/index.js";
import { resolveBinary, type BinaryResolution } from "../binary/resolver.js";
import { detectHardwareAcceleration } from "../core/quality.js";
import { validateConfig } from "../config/validator.js";
import { checkGitignoreEntries } from "../config/gitignore.js";
import { authoredRoots } from "../config/roots.js";
import { createMediaCache } from "../media/cache.js";
import type { ProjectResolution } from "./project-resolver.js";
import type { CinecodeConfig } from "../core/types/index.js";

export type HealthSectionStatus = "PASS" | "WARN" | "FAIL" | "INFO" | "SKIPPED";

export interface HealthSection<T = unknown> {
  readonly name: string;
  readonly status: HealthSectionStatus;
  readonly message: string;
  readonly details?: T;
  readonly fixHint?: string;
  readonly fixable?: boolean;
}

export interface FfmpegHealth {
  readonly version: string;
  readonly path: string;
  readonly provenance?: string;
  readonly h264: boolean;
  readonly hevc: boolean;
  readonly av1: boolean;
  readonly vp9: boolean;
}

export interface NodeHealth {
  readonly version: string;
  readonly compatible: boolean;
  readonly minimum: string;
  readonly loaderMode: string;
}

export interface WorkerHealth {
  readonly available: number;
  readonly recommended: number;
  readonly totalMemoryMb: number;
}

export interface DiskHealth {
  readonly cacheDir: string;
  readonly tempDir: string;
  readonly cacheFreeGb: number;
  readonly tempFreeGb: number;
  readonly ok: boolean;
}

export interface GpuHealth {
  readonly available: boolean;
  readonly acceleratedCanvas: boolean;
  readonly backend: string;
}

export interface SystemHealthReport {
  readonly ffmpeg: FfmpegHealth;
  readonly node: NodeHealth;
  readonly workers: WorkerHealth;
  readonly diskSpace: DiskHealth;
  readonly gpu: GpuHealth;
  readonly issues: readonly string[];
}

export interface HealthReport extends SystemHealthReport {
  readonly passed: boolean;
  readonly isProject: boolean;
  readonly sections: {
    readonly runtime: HealthSection;
    readonly binaries: HealthSection;
    readonly encoders: HealthSection;
    readonly hardwareAcceleration: HealthSection;
    readonly fonts: HealthSection;
    readonly roots: HealthSection;
    readonly config: HealthSection;
    readonly manifest: HealthSection;
    readonly resources: HealthSection;
    readonly preview: HealthSection;
    readonly gitignore: HealthSection;
  };
  readonly checks: readonly HealthSection[];
  readonly notes: readonly string[];
  readonly system: {
    readonly runtime: unknown;
    readonly binaries: unknown;
    readonly hardwareAcceleration: unknown;
    readonly resources: unknown;
    readonly preview: unknown;
  };
}

let cachedEncoders: Set<string> | null = null;

export function resetEncoderCache(): void {
  cachedEncoders = null;
}

export function probeAvailableEncoders(ffmpegPath: string): Set<string> {
  if (cachedEncoders !== null) return cachedEncoders;
  const set = new Set<string>();
  try {
    const res = spawnSync(ffmpegPath, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const stdout = res.stdout ?? "";
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*[VAFS.]{6}\s+(\S+)/.exec(line);
      if (match?.[1]) {
        set.add(match[1]);
      }
    }
  } catch {
    // Note: Return empty set on probe failure
  }
  cachedEncoders = set;
  return set;
}

function hasCodecEncoder(codec: string, encoders: Set<string>): boolean {
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

async function freeGigabytes(target: string): Promise<number> {
  try {
    const stats = await statfs(target);
    return (stats.bavail * stats.bsize) / (1024 ** 3);
  } catch {
    return 0;
  }
}

export interface CollectHealthOptions {
  readonly cacheDir?: string;
  readonly requiredCodec?: string;
}

export async function collectHealthReport(
  resolution?: ProjectResolution | null,
  options: CollectHealthOptions = {},
): Promise<HealthReport> {
  const isProject = resolution !== null && resolution !== undefined;
  const config = resolution?.config;
  const projectRoot = resolution?.root ?? process.cwd();
  const notes: string[] = [];
  const issues: string[] = [];

  if (!isProject) {
    notes.push("No project found in current directory; running global environment checks only.");
  }

  // Section 1: Runtime
  let runtimeSection: HealthSection;
  let nodeCompatible = true;
  let nodeVersionStr = process.version;
  let loaderModeStr = "esm";
  let minNodeStr = "22.18.0";
  try {
    const runtime = checkRuntime();
    nodeCompatible = runtime.supported;
    nodeVersionStr = runtime.version;
    loaderModeStr = runtime.loaderMode;
    minNodeStr = runtime.minimum;
    const plat = platform();
    const architecture = arch();
    if (!runtime.supported) {
      issues.push(`Node.js ${runtime.version} is below required ${runtime.minimum}`);
    }
    runtimeSection = {
      name: "Runtime",
      status: runtime.supported ? "PASS" : "FAIL",
      message: `Node.js ${runtime.version} (${runtime.supported ? "supported" : "unsupported"}, ${runtime.loaderMode}, ${plat} ${architecture})`,
      details: {
        nodeVersion: runtime.version,
        compatible: runtime.supported,
        minimum: runtime.minimum,
        loaderMode: runtime.loaderMode,
        authoringContract: runtime.authoringContract,
        platform: plat,
        arch: architecture,
      },
      fixHint: runtime.supported ? undefined : `Upgrade Node.js to >= ${runtime.minimum}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Runtime check error: ${msg}`);
    runtimeSection = {
      name: "Runtime",
      status: "FAIL",
      message: `Runtime check failed: ${msg}`,
      fixHint: "Ensure Node.js environment is valid",
    };
  }

  // Section 2: Binaries
  let binariesSection: HealthSection;
  let ffmpegRes: BinaryResolution | null = null;
  let ffprobeRes: BinaryResolution | null = null;
  try {
    const binariesConfig = { ...config?.binaries, root: projectRoot };
    ffmpegRes = resolveBinary("ffmpeg", binariesConfig, { probeVersion: true });
    ffprobeRes = resolveBinary("ffprobe", binariesConfig, { probeVersion: true });
    const ffmpegOk = ffmpegRes.version !== "unknown" && ffmpegRes.version !== "not found";
    const ffprobeOk = ffprobeRes.version !== "unknown" && ffprobeRes.version !== "not found";

    if (!ffmpegOk) issues.push(`FFmpeg binary not available at ${ffmpegRes.path}`);
    if (!ffprobeOk) issues.push(`FFprobe binary not available at ${ffprobeRes.path}`);

    const ok = ffmpegOk && ffprobeOk;
    binariesSection = {
      name: "Binaries",
      status: ok ? "PASS" : "FAIL",
      message: `ffmpeg ${ffmpegRes.version} (${ffmpegRes.provenance}) at ${ffmpegRes.path}, ffprobe ${ffprobeRes.version} (${ffprobeRes.provenance}) at ${ffprobeRes.path}`,
      details: { ffmpeg: ffmpegRes, ffprobe: ffprobeRes },
      fixHint: ok ? undefined : "Install ffmpeg and ffprobe, or specify explicit paths in cinecode.config.ts",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Binary resolution failed: ${msg}`);
    binariesSection = {
      name: "Binaries",
      status: "FAIL",
      message: `Binary check failed: ${msg}`,
      fixHint: "Ensure ffmpeg is installed and available in PATH or cinecode.config.ts",
    };
  }

  // Section 3: Encoders
  let encodersSection: HealthSection;
  const availableEncoders = ffmpegRes ? probeAvailableEncoders(ffmpegRes.path) : new Set<string>();
  const hasH264 = hasCodecEncoder("h264", availableEncoders);
  const hasHevc = hasCodecEncoder("hevc", availableEncoders);
  const hasAv1 = hasCodecEncoder("av1", availableEncoders);
  const hasVp9 = hasCodecEncoder("vp9", availableEncoders);

  try {
    const requiredCodecs: string[] = [];
    if (options.requiredCodec) {
      requiredCodecs.push(options.requiredCodec);
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
      encodersSection = {
        name: "Encoders",
        status: "FAIL",
        message: `Missing required encoder(s): ${missingRequired.join(", ")}`,
        details: {
          available: Array.from(availableEncoders),
          requiredByProject: requiredCodecs,
          missingRequired,
        },
        fixHint: `Install an ffmpeg build that includes support for ${missingRequired.join(", ")}`,
      };
    } else {
      const summaryList = ["libx264", "libx265", "libaom-av1", "libvpx-vp9", "prores_ks", "ffv1"].filter((e) =>
        availableEncoders.has(e),
      );
      encodersSection = {
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
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    encodersSection = {
      name: "Encoders",
      status: "FAIL",
      message: `Encoder probe failed: ${msg}`,
      fixHint: "Check ffmpeg installation",
    };
  }

  // Section 4: Hardware Acceleration
  let hwSection: HealthSection;
  try {
    const backend = detectHardwareAcceleration();
    hwSection = {
      name: "Hardware Acceleration",
      status: "PASS",
      message: backend !== "software" ? `Detected hardware encoder: ${backend}` : "Using software encoder (no hardware acceleration detected)",
      details: { detected: backend !== "software", backend },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hwSection = {
      name: "Hardware Acceleration",
      status: "WARN",
      message: `Hardware acceleration probe error: ${msg}`,
    };
  }

  // Section 5: Fonts
  let fontsSection: HealthSection;
  if (!isProject || !config) {
    fontsSection = {
      name: "Fonts",
      status: "SKIPPED",
      message: "No project configured (project-free mode)",
    };
  } else if (!config.fonts || config.fonts.length === 0) {
    fontsSection = {
      name: "Fonts",
      status: "PASS",
      message: "No custom fonts configured",
      details: { count: 0, families: [], errors: [], warnings: [] },
    };
  } else {
    try {
      const { registerProjectFonts, describeRegisteredFonts } = await import("../renderer/text/fonts.js");
      const result = registerProjectFonts(config.fonts, {
        projectRoot,
        mediaDir: config.mediaDir ?? "media",
      });
      if (result.errors.length > 0) {
        const first = result.errors[0]!;
        issues.push(`Font registration failed for "${first.family}": ${first.message}`);
        fontsSection = {
          name: "Fonts",
          status: "FAIL",
          message: `Font registration failed for "${first.family}": ${first.message}`,
          details: {
            count: 0,
            families: [],
            errors: result.errors.map((e) => e.message),
            warnings: result.warnings,
          },
          fixHint: "Ensure custom font files exist at the configured paths",
        };
      } else {
        const desc = describeRegisteredFonts();
        fontsSection = {
          name: "Fonts",
          status: result.warnings.length > 0 ? "WARN" : "PASS",
          message: `${desc.count} font(s) registered: ${desc.families.join(", ")}${result.warnings.length > 0 ? ` (${result.warnings.length} duplicate family entry ignored)` : ""}`,
          details: {
            count: desc.count,
            families: desc.families,
            errors: [],
            warnings: result.warnings,
          },
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`Font loading error: ${msg}`);
      fontsSection = {
        name: "Fonts",
        status: "FAIL",
        message: `Font check failed: ${msg}`,
        fixHint: "Verify font files and configuration",
      };
    }
  }

  // Section 6: Roots
  let rootsSection: HealthSection;
  if (!isProject || !resolution) {
    rootsSection = {
      name: "Roots",
      status: "SKIPPED",
      message: "No project roots (project-free mode)",
    };
  } else {
    const roots = resolution.context.roots;
    const dirs = [roots.source, roots.media, roots.output, roots.cache];
    const unwritable: string[] = [];
    for (const dir of dirs) {
      try {
        await access(dir, constants.W_OK);
      } catch {
        unwritable.push(dir);
      }
    }
    if (unwritable.length === 0) {
      rootsSection = {
        name: "Roots",
        status: "PASS",
        message: "sourceDir, mediaDir, outputDir, cacheDir exist and writable",
        details: { ...roots, writable: true },
      };
    } else {
      rootsSection = {
        name: "Roots",
        status: "WARN",
        message: `Folders not existing or not writable: ${unwritable.join(", ")}`,
        details: { ...roots, writable: false, unwritable },
        fixHint: "Ensure project directories exist and have write permissions",
      };
    }
  }

  // Section 7: Config
  let configSection: HealthSection;
  if (!isProject || !config || !resolution) {
    configSection = {
      name: "Config",
      status: "SKIPPED",
      message: "No configuration file (project-free mode)",
    };
  } else {
    try {
      const validation = validateConfig(config, resolution.configPath, resolution.root);
      if (validation.errors.length === 0) {
        configSection = {
          name: "Config",
          status: "PASS",
          message: `Configuration valid (${resolution.configPath})`,
          details: { valid: true, path: resolution.configPath, errors: [] },
        };
      } else {
        const errorMsgs = validation.errors.map((e) => e.message);
        issues.push(...errorMsgs);
        configSection = {
          name: "Config",
          status: "FAIL",
          message: errorMsgs.join(" | "),
          details: { valid: false, path: resolution.configPath, errors: errorMsgs },
          fixHint: "Correct invalid configuration properties in cinecode.config.ts",
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`Config check error: ${msg}`);
      configSection = {
        name: "Config",
        status: "FAIL",
        message: `Config check failed: ${msg}`,
        fixHint: "Fix syntax or type errors in configuration file",
      };
    }
  }

  // Section 8: Manifest
  let manifestSection: HealthSection;
  if (!isProject || !resolution) {
    manifestSection = {
      name: "Manifest",
      status: "SKIPPED",
      message: "No manifest (project-free mode)",
    };
  } else if (!resolution.manifest) {
    manifestSection = {
      name: "Manifest",
      status: "INFO",
      message: `Standalone file entry: ${resolution.manifestPath}`,
      details: { valid: true, standalone: true },
    };
  } else {
    const valid = resolution.manifest.validation?.valid ?? true;
    const errors = resolution.manifest.validation?.errors ?? [];
    if (valid) {
      manifestSection = {
        name: "Manifest",
        status: "PASS",
        message: `Manifest valid (${resolution.manifest.entryPath})`,
        details: {
          valid: true,
          entryPath: resolution.manifest.entryPath,
          scenes: resolution.manifest.manifest.scenes?.length ?? 0,
          timelines: resolution.manifest.manifest.timelines?.length ?? 0,
        },
      };
    } else {
      const msgs = errors.map((e) => e.message);
      issues.push(...msgs);
      manifestSection = {
        name: "Manifest",
        status: "FAIL",
        message: msgs.join(" | "),
        details: { valid: false, errors: msgs },
        fixHint: "Correct manifest definitions in entry file",
      };
    }
  }

  // Section 9: Resources
  let resourcesSection: HealthSection;
  const cpuCount = cpus().length;
  const recommendedWorkers = Math.max(1, Math.min(cpuCount, 4));
  const totalMem = Math.round(totalmem() / (1024 * 1024));
  const freeMem = Math.round(freemem() / (1024 * 1024));
  const targetDir = resolution?.context.roots.cache ?? options.cacheDir ?? ".cinecode/cache";
  const [cacheFreeGb, tempFreeGb] = await Promise.all([
    freeGigabytes(targetDir),
    freeGigabytes(resolve(".")),
  ]);
  const diskOk = (cacheFreeGb > 0 ? cacheFreeGb : tempFreeGb) >= 1;
  if (!diskOk) {
    issues.push("Less than 1 GB free disk space available");
  }
  resourcesSection = {
    name: "Resources",
    status: diskOk ? "PASS" : "WARN",
    message: `${cpuCount} CPUs available (${recommendedWorkers} recommended), ${totalMem} MB RAM (${freeMem} MB free), ${(cacheFreeGb > 0 ? cacheFreeGb : tempFreeGb).toFixed(1)} GB disk free`,
    details: {
      concurrency: recommendedWorkers,
      cpuCount,
      memoryBudgetMb: freeMem,
      totalMemoryMb: totalMem,
      freeMemoryMb: freeMem,
      diskFreeGb: cacheFreeGb > 0 ? cacheFreeGb : tempFreeGb,
      diskOk,
    },
    fixHint: diskOk ? undefined : "Free up disk space on the target volume",
  };

  // Section 10: Preview / Canvas
  let previewSection: HealthSection;
  let canvasOk = false;
  let canvasBackend = "software";
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const CanvasCtor = canvasModule.Canvas;
    const canvas = new CanvasCtor(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 8, 8);
    canvasOk = true;
    canvasBackend = "skia";
    previewSection = {
      name: "Preview",
      status: "PASS",
      message: "Canvas renderer available (skia)",
      details: { canvasAvailable: true, backend: "skia" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Canvas initialization failed: ${msg}`);
    previewSection = {
      name: "Preview",
      status: "FAIL",
      message: `Canvas initialization failed: ${msg}`,
      details: { canvasAvailable: false, backend: "none" },
      fixHint: "Install or rebuild @napi-rs/canvas for your platform",
    };
  }

  // Section 11: .gitignore (managed block)
  let gitignoreSection: HealthSection;
  if (!isProject || !config) {
    gitignoreSection = {
      name: ".gitignore",
      status: "SKIPPED",
      message: "No project .gitignore check (project-free mode)",
    };
  } else {
    try {
      const authored = authoredRoots(config);
      const res = await checkGitignoreEntries({
        sourceDir: authored.source,
        mediaDir: authored.media,
        outputDir: authored.output,
        cacheDir: authored.cache,
        projectRoot,
        enabled: config.gitignore ?? true,
      });
      if (res.missing.length === 0) {
        gitignoreSection = {
          name: ".gitignore",
          status: "PASS",
          message: "All required managed entries present",
          details: { missing: [], present: res.present },
          fixable: false,
        };
      } else {
        gitignoreSection = {
          name: ".gitignore",
          status: "WARN",
          message: `Missing entries: ${res.missing.join(", ")}`,
          details: { missing: res.missing, present: res.present },
          fixHint: "Run `cinecode doctor --fix` to add missing entries to .gitignore",
          fixable: true,
        };
      }
    } catch {
      gitignoreSection = {
        name: ".gitignore",
        status: "WARN",
        message: "Could not read .gitignore",
        fixable: true,
      };
    }
  }

  const sections = {
    runtime: runtimeSection,
    binaries: binariesSection,
    encoders: encodersSection,
    hardwareAcceleration: hwSection,
    fonts: fontsSection,
    roots: rootsSection,
    config: configSection,
    manifest: manifestSection,
    resources: resourcesSection,
    preview: previewSection,
    gitignore: gitignoreSection,
  };

  const checks = [
    runtimeSection,
    binariesSection,
    encodersSection,
    hwSection,
    fontsSection,
    rootsSection,
    configSection,
    manifestSection,
    resourcesSection,
    previewSection,
    gitignoreSection,
  ];

  const passed = checks.every((c) => c.status !== "FAIL");

  return {
    passed,
    isProject,
    sections,
    checks,
    issues,
    notes,
    system: {
      runtime: runtimeSection.details,
      binaries: binariesSection.details,
      hardwareAcceleration: hwSection.details,
      resources: resourcesSection.details,
      preview: previewSection.details,
    },
    // Compatibility fields matching SystemHealthReport
    ffmpeg: {
      version: ffmpegRes?.version ?? "not found",
      path: ffmpegRes?.path ?? "",
      provenance: ffmpegRes?.provenance,
      h264: hasH264,
      hevc: hasHevc,
      av1: hasAv1,
      vp9: hasVp9,
    },
    node: {
      version: nodeVersionStr,
      compatible: nodeCompatible,
      minimum: minNodeStr,
      loaderMode: loaderModeStr,
    },
    workers: {
      available: cpuCount,
      recommended: recommendedWorkers,
      totalMemoryMb: totalMem,
    },
    diskSpace: {
      cacheDir: `${cacheFreeGb.toFixed(1)}GB free`,
      tempDir: `${tempFreeGb.toFixed(1)}GB free`,
      cacheFreeGb,
      tempFreeGb,
      ok: diskOk,
    },
    gpu: {
      available: canvasOk,
      acceleratedCanvas: canvasOk,
      backend: canvasBackend,
    },
  };
}
