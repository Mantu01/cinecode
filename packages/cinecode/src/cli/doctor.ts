import { Command } from "commander";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { platform, arch, freemem } from "node:os";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { access, constants, rm, statfs } from "node:fs/promises";
import { resolveBinary } from "../binary/resolver.js";
import type { CinecodeConfig } from "../core/types/index.js";
import { validateConfig } from "../config/validator.js";
import { checkGitignoreEntries, ensureGitignoreEntries } from "../config/gitignore.js";
import { createProjectResolver, reportResolution, type MediaAccess } from "./project-resolver.js";
import { createMediaCache } from "../media/cache.js";
import { authoredRoots, type ProjectRoots } from "../config/roots.js";
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
    const execFileAsync = promisify(execFile);
    const ffmpeg = resolveBinary("ffmpeg");
    const { stdout } = await execFileAsync(ffmpeg.path, ["-hide_banner", "-encoders"], { timeout: 2000 });
    const required = ["libx264", "libx265", "libvpx-vp9", "libaom-av1", "prores_ks", "ffv1"];
    const missing = required.filter((name) => !stdout.includes(name));
    if (missing.length > 0) {
      return { name: "Encoder", status: "WARN", message: `Missing encoder capabilities: ${missing.join(", ")}` };
    }
    return { name: "Encoder", status: "PASS", message: `Encoder probe: ${required.join(", ")}` };
  } catch (e) {
    return { name: "Encoder", status: "FAIL", message: `Encoder capability probe failed: ${e instanceof Error ? e.message : "Unknown error"}`, fixable: false };
  }
}

async function checkFonts(config: CinecodeConfig, root: string): Promise<DoctorCheck> {
  if (!config.fonts || config.fonts.length === 0) {
    return { name: "Fonts", status: "PASS", message: "No custom fonts configured" };
  }
  const { registerProjectFonts, describeRegisteredFonts } = await import("../renderer/text/fonts.js");
  const result = registerProjectFonts(config.fonts, {
    projectRoot: root,
    mediaDir: config.mediaDir ?? "media",
  });
  if (result.errors.length > 0) {
    const first = result.errors[0]!;
    return {
      name: "Fonts",
      status: "FAIL",
      message: `Font registration failed for "${first.family}": ${first.message}`,
      fixable: false,
    };
  }
  const description = describeRegisteredFonts();
  return {
    name: "Fonts",
    status: result.warnings.length > 0 ? "WARN" : "PASS",
    message: `${description.count} font(s) registered: ${description.families.join(", ")}${result.warnings.length > 0 ? ` (${result.warnings.length} duplicate family entry ignored)` : ""}`,
    fixable: false,
  };
}

async function checkFolders(roots: ProjectRoots): Promise<DoctorCheck> {
  const dirs = [roots.source, roots.media, roots.output, roots.cache];
  const issues: string[] = [];

  for (const dir of dirs) {
    try {
      await access(dir, constants.W_OK);
    } catch {
      issues.push(dir);
    }
  }

  if (issues.length === 0) {
    return { name: "Folders", status: "PASS", message: "sourceDir, mediaDir, outputDir, cacheDir exist and writable" };
  }
  return { name: "Folders", status: "FAIL", message: `Not writable: ${issues.join(", ")}`, fixable: true };
}

async function checkDiskSpace(projectRoot: string): Promise<DoctorCheck> {
  try {
    const stats = await statfs(projectRoot);
    const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);
    if (freeGB >= 1) {
      return { name: "Disk space", status: "PASS", message: `${freeGB.toFixed(1)} GB free` };
    }
    return { name: "Disk space", status: "WARN", message: `${freeGB.toFixed(1)} GB free (< 1 GB)` };
  } catch {
    return { name: "Disk space", status: "WARN", message: "Could not determine free disk space" };
  }
}

async function checkConfig(config: CinecodeConfig, configPath: string, root: string): Promise<DoctorCheck> {
  const validation = validateConfig(config, configPath, root);
  if (validation.errors.length === 0) {
    return { name: "Config", status: "PASS", message: "Configuration valid" };
  }
  return { name: "Config", status: "FAIL", message: validation.errors.map((error) => error.message).join(" | "), fixable: false };
}

async function checkMedia(load: () => Promise<MediaAccess>): Promise<DoctorCheck> {
  try {
    const media = await (await load()).catalog.listMedia();
    return { name: "Media", status: "PASS", message: `${media.length} local media file(s) present` };
  } catch (error) {
    return { name: "Media", status: "FAIL", message: `Media check failed: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

async function checkGitignore(config: CinecodeConfig, projectRoot: string): Promise<DoctorCheck> {
  const authored = authoredRoots(config);
  const result = await checkGitignoreEntries({
    sourceDir: authored.source,
    mediaDir: authored.media,
    outputDir: authored.output,
    cacheDir: authored.cache,
    projectRoot,
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
  const resolution = resolveBinary("ffmpeg");
  const banner = await runFfmpegVersion(resolution.path);
  if (!banner) {
    return { name: "FFmpeg", status: "FAIL", message: `ffmpeg not executable at ${resolution.path}`, fixable: false };
  }
  const version = /ffmpeg version (\S+)/.exec(banner)?.[1] ?? "unknown";
  return { name: "FFmpeg", status: "PASS", message: `ffmpeg ${version} at ${resolution.path} (${resolution.provenance})` };
}

async function checkFFprobe(): Promise<DoctorCheck> {
  try {
    const resolution = resolveBinary("ffprobe");
    return {
      name: "FFprobe",
      status: "PASS",
      message: `ffprobe ${resolution.version} at ${resolution.path} (${resolution.provenance})`,
    };
  } catch (error) {
    return {
      name: "FFprobe",
      status: "FAIL",
      message: error instanceof Error ? error.message : "ffprobe binary unavailable",
      fixable: false,
    };
  }
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

async function checkCache(roots: ProjectRoots): Promise<DoctorCheck> {
  try {
    const cache = createMediaCache(roots.cache);
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

export async function doctorCommand(options: { config?: string; root?: string; fix?: boolean; json?: boolean; verbose?: boolean }): Promise<void> {
  const resolver = createProjectResolver({ root: options.root, config: options.config });
  const resolution = await resolver.resolve();
  reportResolution(resolution, options.verbose === true);
  const config = resolution.config;
  const roots = resolution.context.roots;

  const runChecks = (): Promise<DoctorCheck[]> =>
    Promise.all([
      checkNodeVersion(),
      checkAuthoringContract(),
      checkPlatform(),
      checkRenderer(),
      checkEncoder(),
      checkFfmpeg(),
      checkFFprobe(),
      checkFonts(config, resolution.root),
      checkFolders(roots),
      checkDiskSpace(resolution.root),
      checkConfig(config, resolution.configPath, resolution.root),
      checkMedia(() => resolution.media()),
      checkCache(roots),
      checkGitignore(config, resolution.root),
      checkCloudUrls(config),
      checkDeprecatedUsage(resolution.configPath),
    ]);

  let checks = await runChecks();

  if (options.fix) {
    const fixable = checks.filter((check) => check.fixable && check.status !== "PASS");
    for (const check of fixable) {
      if (check.fixable && check.status !== "PASS") {
        if (check.name === "Folders") {
          for (const dir of [roots.source, roots.media, roots.output, roots.cache]) {
            try {
              await import("node:fs/promises").then(fs => fs.mkdir(dir, { recursive: true }));
            } catch {
              void 0;
            }
          }
          console.log("Fixed: Created missing folders");
        }
        if (check.name === "Cache") {
          const cache = createMediaCache(roots.cache);
          await cache.initialize();
          const removed = await cache.pruneMissingSources();
          console.log(`Fixed: Pruned ${removed} dangling cache entries`);
        }
        if (check.name === ".gitignore") {
          const authored = authoredRoots(config);
          await ensureGitignoreEntries({
            sourceDir: authored.source,
            mediaDir: authored.media,
            outputDir: authored.output,
            cacheDir: authored.cache,
            projectRoot: resolution.root,
            enabled: config.gitignore ?? true,
          });
          console.log("Fixed: .gitignore entries added");
        }
      }
    }
    /* --fix reports success only after the checks it touched pass again. */
    if (fixable.length > 0) checks = await runChecks();
  }

  runReport.result({ checks });
  for (const check of checks) {
    if (check.status !== "PASS") runReport.warn(String(check.name).startsWith("ffmpeg") ? ErrorCode.CC7002 : ErrorCode.CC7004, check.message);
  }

  if (!runReport.isMachine()) {
    for (const check of checks) {
      const statusColor = check.status === "PASS" ? "\x1b[32m" : check.status === "WARN" ? "\x1b[33m" : "\x1b[31m";
      const reset = "\x1b[0m";
      const fixable = check.fixable ? " (fixable)" : "";
      console.log(`${statusColor}[${check.status}]${reset} ${check.name}: ${check.message}${fixable}`);
    }
  }

  const failed = checks.filter(c => c.status === "FAIL");
  if (failed.length > 0) {
    throw createError(ErrorCode.CC7004, { reason: `${failed.map(c => `${c.name}: ${c.message}`).join(", ")}` });
  }
}

export function createDoctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Run environment and project health checks")
    .option("--fix", "Auto-fix issues where possible", false)
    .action(async (options: { config?: string; fix?: boolean; json?: boolean }, command: Command) => {
      await doctorCommand({ ...command.optsWithGlobals(), ...options });
    });
  return cmd;
}