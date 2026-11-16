import { Command } from "commander";
import { platform, arch, freemem } from "node:os";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { access, constants } from "node:fs/promises";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import type { CinecodeConfig } from "../core/types/index.js";
import { loadConfig } from "../config/schema.js";
import { validateConfig } from "../config/validator.js";
import { checkGitignoreEntries, ensureGitignoreEntries } from "../config/gitignore.js";
import { createMediaResolver } from "../media/resolver.js";
import { createMediaCache } from "../media/cache.js";
import { renderVideo, type RenderOptions } from "../pipeline/index.js";
import { checkRuntime } from "../loader/index.js";

interface DoctorCheck {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
  fixable?: boolean;
}

async function checkNodeVersion(): Promise<DoctorCheck> {
  const runtime = checkRuntime();
  return {
    name: "Node version",
    status: runtime.supported ? "PASS" : "FAIL",
    message: `Node.js ${runtime.version} (required ${runtime.minimum})`,
    fixable: false,
  };
}

async function checkAuthoringContract(): Promise<DoctorCheck> {
  const runtime = checkRuntime();
  return {
    name: "Authoring contract",
    status: runtime.supported ? "PASS" : "WARN",
    message: `${runtime.loaderMode}: ${runtime.authoringContract}`,
    fixable: false,
  };
}

async function checkPlatform(): Promise<DoctorCheck> {
  const plat = platform();
  const supported = ["win32", "darwin", "linux"];
  if (supported.includes(plat)) {
    return { name: "Platform", status: "PASS", message: `${plat} (${arch()})` };
  }
  return { name: "Platform", status: "WARN", message: `${plat} (${arch()}) - not officially supported` };
}

async function checkRenderer(): Promise<DoctorCheck> {
  try {
    const canvasModule = await import("@napi-rs/canvas").catch(() => null);
    if (!canvasModule) {
      return { name: "Renderer", status: "WARN", message: "Canvas module not available" };
    }
    const { Canvas } = canvasModule;
    const canvas = new Canvas(100, 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 100, 100);
    return { name: "Renderer", status: "PASS", message: "Canvas initialized successfully" };
  } catch (e) {
    return { name: "Renderer", status: "FAIL", message: `Canvas initialization failed: ${e instanceof Error ? e.message : "Unknown error"}`, fixable: false };
  }
}

async function checkEncoder(): Promise<DoctorCheck> {
  try {
    const testOptions: RenderOptions = {
      composition: {
        name: "doctor-test",
        width: 128,
        height: 128,
        fps: 30,
        duration: 1 / 30,
        background: "#000000",
        audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
        rootTimeline: { tracks: [] },
      },
      outputPath: resolve(".cinecode", "doctor-test.mp4"),
      cacheDir: resolve(".cinecode", "cache"),
      seed: 0,
      concurrency: 1,
      chunkSize: 1,
      quality: "preview",
      overwrite: true,
      fresh: true,
      noCache: true,
      fromFrame: 0,
      toFrame: 1,
      silent: true,
    };
    await renderVideo(testOptions);
    return { name: "Encoder", status: "PASS", message: "Test encode successful" };
  } catch (e) {
    return { name: "Encoder", status: "FAIL", message: `Test encode failed: ${e instanceof Error ? e.message : "Unknown error"}`, fixable: false };
  }
}

async function checkFonts(config: CinecodeConfig): Promise<DoctorCheck> {
  try {
    if (config.fonts) {
      for (const font of config.fonts) {
        await import(font.src);
      }
      return { name: "Fonts", status: "PASS", message: `${config.fonts.length} font(s) loaded` };
    }
    return { name: "Fonts", status: "PASS", message: "No custom fonts configured" };
  } catch (e) {
    return { name: "Fonts", status: "FAIL", message: `Font loading failed: ${e instanceof Error ? e.message : "Unknown error"}`, fixable: false };
  }
}

async function checkFolders(config: CinecodeConfig): Promise<DoctorCheck> {
  const outputDir = config.outputDir ?? "output";
  const cacheDir = config.cacheDir ?? ".cinecode/cache";
  const dirs = [config.sourceDir, outputDir, cacheDir];
  const issues: string[] = [];

  for (const dir of dirs) {
    try {
      await access(resolve(dir), constants.W_OK);
    } catch {
      issues.push(dir);
    }
  }

  if (issues.length === 0) {
    return { name: "Folders", status: "PASS", message: "sourceDir, outputDir, cacheDir exist and writable" };
  }
  return { name: "Folders", status: "FAIL", message: `Not writable: ${issues.join(", ")}`, fixable: true };
}

async function checkDiskSpace(): Promise<DoctorCheck> {
  const freeGB = freemem() / (1024 ** 3);
  if (freeGB >= 1) {
    return { name: "Disk space", status: "PASS", message: `${freeGB.toFixed(1)} GB free` };
  }
  return { name: "Disk space", status: "WARN", message: `${freeGB.toFixed(1)} GB free (< 1 GB)` };
}

async function checkConfig(config: CinecodeConfig, configPath: string): Promise<DoctorCheck> {
  const validation = validateConfig(config, configPath);
  if (validation.errors.length === 0) {
    return { name: "Config", status: "PASS", message: "Configuration valid" };
  }
  return { name: "Config", status: "FAIL", message: `${validation.errors.length} error(s)`, fixable: false };
}

async function checkMedia(config: CinecodeConfig): Promise<DoctorCheck> {
  try {
    const cache = createMediaCache(config.cacheDir ?? ".cinecode/cache");
    await cache.initialize();
    const resolver = createMediaResolver({ sourceDir: config.sourceDir, cache, cloudMedia: config.cloudMedia ?? [] });
    await resolver.initialize();
    const media = await resolver.listMedia();
    return { name: "Media", status: "PASS", message: `${media.length} local media file(s) present` };
  } catch (e) {
    return { name: "Media", status: "FAIL", message: `Media check failed: ${e instanceof Error ? e.message : "Unknown error"}` };
  }
}

async function checkGitignore(config: CinecodeConfig): Promise<DoctorCheck> {
  const result = await checkGitignoreEntries({
    sourceDir: config.sourceDir,
    outputDir: config.outputDir ?? "output",
    cacheDir: config.cacheDir ?? ".cinecode/cache",
    projectRoot: process.cwd(),
    enabled: config.gitignore ?? true,
  });
  if (result.missing.length === 0) {
    return { name: ".gitignore", status: "PASS", message: "All required entries present" };
  }
  return { name: ".gitignore", status: "WARN", message: `Missing entries: ${result.missing.join(", ")}`, fixable: true };
}

async function checkCloudUrls(config: CinecodeConfig): Promise<DoctorCheck> {
  const cloudMedia = config.cloudMedia ?? [];
  const unsupported = cloudMedia.filter(c => !c.url.startsWith("https://") && !c.url.startsWith("http://"));
  if (unsupported.length === 0) {
    return { name: "Cloud URLs", status: "PASS", message: `${cloudMedia.length} URL(s) valid` };
  }
  return { name: "Cloud URLs", status: "WARN", message: `${unsupported.length} unsupported URL(s)`, fixable: false };
}

function runFfmpegVersion(binary: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(binary, ["-hide_banner", "-version"], { windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => resolvePromise(null));
    child.on("close", (code) => resolvePromise(code === 0 ? output : null));
  });
}

async function checkFfmpeg(): Promise<DoctorCheck> {
  const banner = await runFfmpegVersion(ffmpegStatic.path);
  if (!banner) {
    return { name: "FFmpeg", status: "FAIL", message: `ffmpeg not executable at ${ffmpegStatic.path}`, fixable: false };
  }
  const version = /ffmpeg version (\S+)/.exec(banner)?.[1] ?? "unknown";
  return { name: "FFmpeg", status: "PASS", message: `ffmpeg ${version}` };
}

const DEPRECATED_PATTERNS: readonly { readonly pattern: RegExp; readonly hint: string }[] = [
  { pattern: /schemaVersion\s*:\s*1\b/, hint: "schemaVersion 1 is deprecated; migrate to schemaVersion 2 blocks" },
  { pattern: /quality\s*:\s*["'](?:low|medium|high)["']/, hint: "legacy quality names low/medium/high; use draft/preview/medium/final/lossless" },
  { pattern: /burnSubtitles\s*:/, hint: "burnSubtitles moved to render options; set it on the render call" },
];

async function checkDeprecatedUsage(configPath: string): Promise<DoctorCheck> {
  const source = await readFile(resolve(configPath), "utf-8").catch(() => null);
  if (source === null) {
    return { name: "Deprecated API", status: "PASS", message: "Config source not readable, skipped" };
  }
  const found = DEPRECATED_PATTERNS.filter((entry) => entry.pattern.test(source)).map((entry) => entry.hint);
  if (found.length === 0) {
    return { name: "Deprecated API", status: "PASS", message: "No deprecated patterns detected" };
  }
  return { name: "Deprecated API", status: "WARN", message: found.join("; ") };
}

async function checkCache(config: CinecodeConfig): Promise<DoctorCheck> {
  try {
    const cache = createMediaCache(resolve(config.cacheDir ?? ".cinecode/cache"));
    await cache.initialize();
    const stats = await cache.getStats();
    return {
      name: "Cache",
      status: stats.metadataEntries > 0 ? "PASS" : "WARN",
      message: `${stats.metadataEntries} metadata entries, ${stats.frameEntries} frames, ${(stats.hitRate * 100).toFixed(0)}% hit rate`,
      fixable: true,
    };
  } catch (e) {
    return { name: "Cache", status: "FAIL", message: `Cache check failed: ${e instanceof Error ? e.message : "Unknown error"}`, fixable: true };
  }
}

export async function doctorCommand(options: { config?: string; fix?: boolean; json?: boolean }): Promise<void> {
  const configPath = options.config ?? "cinecode.config.js";
  const config = await loadConfig(resolve(configPath));

  const checks = await Promise.all([
    checkNodeVersion(),
    checkAuthoringContract(),
    checkPlatform(),
    checkRenderer(),
    checkEncoder(),
    checkFfmpeg(),
    checkFonts(config),
    checkFolders(config),
    checkDiskSpace(),
    checkConfig(config, configPath),
    checkMedia(config),
    checkCache(config),
    checkGitignore(config),
    checkCloudUrls(config),
    checkDeprecatedUsage(configPath),
  ]);

  if (options.fix) {
    for (const check of checks) {
      if (check.fixable && check.status !== "PASS") {
        if (check.name === "Folders") {
          const outputDir = config.outputDir ?? "output";
          const cacheDir = config.cacheDir ?? ".cinecode/cache";
          for (const dir of [config.sourceDir, outputDir, cacheDir]) {
            try {
              await import("node:fs/promises").then(fs => fs.mkdir(resolve(dir), { recursive: true }));
            } catch {
              void 0;
            }
          }
          console.log("Fixed: Created missing folders");
        }
        if (check.name === "Cache") {
          const cache = createMediaCache(resolve(config.cacheDir ?? ".cinecode/cache"));
          await cache.initialize();
          const removed = await cache.pruneMissingSources();
          console.log(`Fixed: Pruned ${removed} dangling cache entries`);
        }
        if (check.name === ".gitignore") {
          await ensureGitignoreEntries({
            sourceDir: config.sourceDir,
            outputDir: config.outputDir ?? "output",
            cacheDir: config.cacheDir ?? ".cinecode/cache",
            projectRoot: process.cwd(),
            enabled: config.gitignore ?? true,
          });
          console.log("Fixed: .gitignore entries added");
        }
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }

  for (const check of checks) {
    const statusColor = check.status === "PASS" ? "\x1b[32m" : check.status === "WARN" ? "\x1b[33m" : "\x1b[31m";
    const reset = "\x1b[0m";
    const fixable = check.fixable ? " (fixable)" : "";
    console.log(`${statusColor}[${check.status}]${reset} ${check.name}: ${check.message}${fixable}`);
  }

  const failed = checks.filter(c => c.status === "FAIL").length;
  if (failed > 0) {
    process.exit(1);
  }
}

export function createDoctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Run environment and project health checks")
    .option("-c, --config <path>", "Path to config file")
    .option("--fix", "Auto-fix issues where possible", false)
    .option("--json", "Output as JSON", false)
    .action(async (options: { config?: string; fix?: boolean; json?: boolean }, command: Command) => {
      await doctorCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}