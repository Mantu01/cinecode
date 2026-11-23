import type { ProjectResolution } from "../../resolve/project-resolver.js";
import { collectBinariesHealth } from "./binaries.js";
import { collectConfigHealth } from "./config.js";
import { collectEncodersHealth } from "./encoders.js";
import { collectFontsHealth } from "./fonts.js";
import { collectGitignoreHealth } from "./gitignore.js";
import { collectHardwareHealth } from "./hardware.js";
import { collectManifestHealth } from "./manifest.js";
import { collectPreviewHealth } from "./preview.js";
import { collectResourcesHealth } from "./resources.js";
import { collectRootsHealth } from "./roots.js";
import { collectRuntimeHealth } from "./runtime.js";
import type { CollectHealthOptions, HealthReport, HealthSection } from "./types.js";

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

  const runtime = collectRuntimeHealth(issues);
  const binaries = collectBinariesHealth(config, projectRoot, issues);
  const encoders = collectEncodersHealth(binaries.ffmpeg, config, isProject, options.requiredCodec, issues);
  const hardware = collectHardwareHealth();
  const fonts = await collectFontsHealth(config, projectRoot, isProject, issues);
  const roots = await collectRootsHealth(resolution);
  const configSection = collectConfigHealth(resolution, issues);
  const manifest = collectManifestHealth(resolution, issues);
  const resources = await collectResourcesHealth(resolution, projectRoot, options.cacheDir, issues);
  const preview = await collectPreviewHealth(issues);
  const gitignore = await collectGitignoreHealth(config, projectRoot, isProject);

  const checks = [
    runtime.section,
    binaries.section,
    encoders.section,
    hardware,
    fonts,
    roots,
    configSection,
    manifest,
    resources.section,
    preview.section,
    gitignore,
  ];

  return {
    passed: checks.every((c) => c.status !== "FAIL"),
    isProject,
    sections: {
      runtime: runtime.section,
      binaries: binaries.section,
      encoders: encoders.section,
      hardwareAcceleration: hardware,
      fonts,
      roots,
      config: configSection,
      manifest,
      resources: resources.section,
      preview: preview.section,
      gitignore,
    },
    checks,
    issues,
    notes,
    system: {
      runtime: runtime.section.details,
      binaries: binaries.section.details,
      hardwareAcceleration: hardware.details,
      resources: resources.section.details,
      preview: preview.section.details,
    },
    ffmpeg: {
      version: binaries.ffmpeg?.version ?? "not found",
      path: binaries.ffmpeg?.path ?? "",
      provenance: binaries.ffmpeg?.provenance,
      h264: encoders.h264,
      hevc: encoders.hevc,
      av1: encoders.av1,
      vp9: encoders.vp9,
    },
    node: {
      version: runtime.version,
      compatible: runtime.compatible,
      minimum: runtime.minimum,
      loaderMode: runtime.loaderMode,
    },
    workers: {
      available: resources.cpuCount,
      recommended: resources.recommendedWorkers,
      totalMemoryMb: resources.totalMemoryMb,
    },
    diskSpace: {
      cacheDir: resources.cacheDir,
      outputDir: resources.outputDir,
      cacheFreeGb: resources.cacheFreeGb,
      outputFreeGb: resources.outputFreeGb,
      ok: resources.diskOk,
    },
    gpu: {
      available: preview.canvasOk,
      acceleratedCanvas: false,
      backend: preview.backend,
    },
  };
}
