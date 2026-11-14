import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError, type ErrorLocation } from "../errors/index.js";

const RESERVED_NAMES = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);
const INVALID_CHARS = /[<>:"|?*]/;
const TRAILING_DOT_OR_SPACE = /[. ]+$/;
const KNOWN_KEYS = new Set([
  "schemaVersion",
  "name",
  "project",
  "video",
  "images",
  "dev",
  "sourceDir",
  "outputDir",
  "cacheDir",
  "cloudMedia",
  "render",
  "audio",
  "fonts",
  "concurrency",
  "logLevel",
  "overwrite",
  "gitignore",
  "plugins",
]);
const PROJECT_KEYS = new Set(["name", "entry", "sourceDir", "outputDir", "cacheDir"]);
const VIDEO_KEYS = new Set([
  "title",
  "description",
  "author",
  "version",
  "tags",
  "license",
  "width",
  "height",
  "aspectRatio",
  "fps",
  "defaultDuration",
  "background",
  "colorSpace",
  "pixelAspectRatio",
]);
const IMAGES_KEYS = new Set(["defaultFormat", "quality", "scaleFactor"]);
const DEV_KEYS = new Set(["port", "host", "open", "hmr"]);
const RENDER_KEYS = new Set([
  "fps",
  "resolution",
  "format",
  "background",
  "quality",
  "codec",
  "crf",
  "preset",
  "hardwareAcceleration",
  "concurrency",
  "chunkSize",
]);
const AUDIO_KEYS = new Set(["sampleRate", "channels", "masterVolume", "normalize", "limiter"]);
const VALID_FPS = new Set([23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]);
const VALID_SAMPLE_RATES = new Set([22050, 44100, 48000, 96000]);
const VALID_QUALITY = new Set(["draft", "preview", "final", "lossless", "high", "medium", "low"]);
const VALID_FORMAT = new Set(["mp4", "webm", "prores", "gif", "png"]);
const VALID_CODECS = new Set(["h264", "h265", "av1", "prores", "vp9"]);
const VALID_ENCODER_PRESETS = new Set([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
]);
const VALID_HARDWARE_ACCEL = new Set(["auto", "nvenc", "videotoolbox", "qsv", "off"]);
const VALID_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "21:9"]);
const VALID_COLOR_SPACES = new Set(["srgb", "rec709", "display-p3"]);
const VALID_IMAGE_FORMATS = new Set(["png", "jpg", "webp", "svg"]);
const VALID_LOG_LEVELS = new Set(["silent", "error", "warn", "info", "debug"]);
const RESOLUTION_PRESETS: Record<string, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "4k": [3840, 2160],
  "vertical-1080": [1080, 1920],
  "square-1080": [1080, 1080],
};

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: b.length + 1 }, (_, i) => Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const prevDiag = matrix[i - 1]![j - 1]!;
      const prevUp = matrix[i - 1]![j]!;
      const prevLeft = matrix[i]![j - 1]!;
      if (b[i - 1] === a[j - 1]) matrix[i]![j] = prevDiag;
      else matrix[i]![j] = 1 + Math.min(prevUp, prevLeft, prevDiag);
    }
  }
  return matrix[b.length]![a.length]!;
}

function suggestKey(key: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const known of KNOWN_KEYS) {
    const dist = levenshtein(key, known);
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      best = known;
    }
  }
  for (const known of RENDER_KEYS) {
    const dist = levenshtein(key, `render.${known}`);
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      best = `render.${known}`;
    }
  }
  for (const known of AUDIO_KEYS) {
    const dist = levenshtein(key, `audio.${known}`);
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      best = `audio.${known}`;
    }
  }
  return best;
}

function validatePath(key: string, path: string, configPath: string, kind: "source" | "output" = "output"): CinecodeError[] {
  const errors: CinecodeError[] = [];

  if (INVALID_CHARS.test(path)) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "contains invalid characters <>:\"|?*" }, { location: { file: configPath } }));
  }

  const parts = path.split(/[/\\]/);
  for (const part of parts) {
    // Skip "." and ".." segments — they are legitimate relative-path parts.
    if (part === "." || part === "..") continue;
    if (RESERVED_NAMES.has(part.toUpperCase())) {
      errors.push(createError(ErrorCode.CC1003, { key, path, reason: `contains reserved Windows name: ${part}` }, { location: { file: configPath } }));
    }
    if (TRAILING_DOT_OR_SPACE.test(part)) {
      errors.push(createError(ErrorCode.CC1003, { key, path, reason: "has trailing dots or spaces" }, { location: { file: configPath } }));
    }
  }

  // Guard against clobbering the project root or the source directory — but
  // only for output-ish paths. `sourceDir: "./src"` is legitimate.
  if (resolve(path) === resolve(".")) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "cannot be project root" }, { location: { file: configPath } }));
  }
  if (kind !== "source" && resolve(path) === resolve("src")) {
    errors.push(createError(ErrorCode.CC1003, { key, path, reason: "cannot be src directory" }, { location: { file: configPath } }));
  }

  return errors;
}

function findConfigLocation(configPath: string, keyPath: string): ErrorLocation {
  try {
    const content = readFileSync(configPath, "utf-8");
    const lines = content.split("\n");
    const searchKey = keyPath.split(".").pop() ?? keyPath;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const idx = line.indexOf(searchKey);
      if (idx !== -1 && (line.trimStart().startsWith(searchKey) || line.includes(`"${searchKey}"`) || line.includes(`'${searchKey}'`))) {
        return { file: configPath, line: i + 1, column: idx + 1 };
      }
    }
  } catch {
    return { file: configPath };
  }
  return { file: configPath };
}

export interface ValidationResult {
  readonly errors: CinecodeError[];
  readonly warnings: CinecodeError[];
}

export function validateConfig(config: CinecodeConfig, configPath: string): ValidationResult {
  const errors: CinecodeError[] = [];
  const warnings: CinecodeError[] = [];

  if (config.schemaVersion !== 1 && config.schemaVersion !== 2) {
    errors.push(createError(ErrorCode.CC1004, { version: String(config.schemaVersion), expected: "2" }, { location: findConfigLocation(configPath, "schemaVersion"), fixHint: "Update schemaVersion to 2" }));
  } else if (config.schemaVersion === 1) {
    warnings.push(createError(ErrorCode.CC1004, { version: "1", expected: "2" }, { location: findConfigLocation(configPath, "schemaVersion"), fixHint: "Schema v2 adds project/video/images/dev blocks; v1 still works.", severity: "warning" }));
  }

  if (!config.sourceDir || typeof config.sourceDir !== "string") {
    errors.push(createError(ErrorCode.CC1001, {}, { location: findConfigLocation(configPath, "sourceDir"), fixHint: "Add sourceDir to config" }));
  } else {
    errors.push(...validatePath("sourceDir", config.sourceDir, configPath, "source"));
  }

  const outputDir = config.outputDir ?? "output";
  const cacheDir = config.cacheDir ?? ".cinecode/cache";
  const dirs = [config.sourceDir, outputDir, cacheDir];
  const uniqueDirs = new Set(dirs.map(d => resolve(d)));
  if (uniqueDirs.size !== dirs.length) {
    errors.push(createError(ErrorCode.CC1003, { key: "sourceDir/outputDir/cacheDir", path: dirs.join(", "), reason: "all three directories must be different" }, { location: { file: configPath } }));
  }

  if (config.outputDir) {
    errors.push(...validatePath("outputDir", config.outputDir, configPath));
    if (!resolve(config.outputDir).startsWith(resolve(".") + sep)) {
      warnings.push(createError(ErrorCode.CC1003, { key: "outputDir", path: config.outputDir, reason: "relative paths recommended for portability" }, { location: findConfigLocation(configPath, "outputDir"), severity: "warning" }));
    }
  }

  if (config.cacheDir) {
    errors.push(...validatePath("cacheDir", config.cacheDir, configPath));
    if (!resolve(config.cacheDir).startsWith(resolve(".") + sep)) {
      warnings.push(createError(ErrorCode.CC1003, { key: "cacheDir", path: config.cacheDir, reason: "relative paths recommended for portability" }, { location: findConfigLocation(configPath, "cacheDir"), severity: "warning" }));
    }
  }

  if (config.render) {
    if (config.render.fps !== undefined) {
      if (!VALID_FPS.has(config.render.fps) && !Number.isInteger(config.render.fps)) {
        errors.push(createError(ErrorCode.CC1003, { key: "render.fps", path: String(config.render.fps), reason: "must be integer 1-120 or 23.976, 29.97, 59.94" }, { location: findConfigLocation(configPath, "render.fps") }));
      } else if (config.render.fps < 1 || config.render.fps > 120) {
        errors.push(createError(ErrorCode.CC1003, { key: "render.fps", path: String(config.render.fps), reason: "must be between 1 and 120" }, { location: findConfigLocation(configPath, "render.fps") }));
      }
    }

    if (config.render.resolution && !RESOLUTION_PRESETS[config.render.resolution]) {
        const match = config.render.resolution.match(/^(\d+)x(\d+)$/i);
        if (!match) {
          errors.push(createError(ErrorCode.CC1003, { key: "render.resolution", path: config.render.resolution, reason: 'must be preset or "WIDTHxHEIGHT" with even numbers' }, { location: findConfigLocation(configPath, "render.resolution") }));
        } else {
          const w = parseInt(match[1]!, 10);
          const h = parseInt(match[2]!, 10);
          if (w % 2 !== 0 || h % 2 !== 0) {
            errors.push(createError(ErrorCode.CC1003, { key: "render.resolution", path: config.render.resolution, reason: "width and height must be even numbers" }, { location: findConfigLocation(configPath, "render.resolution") }));
          }
        }
      }

    if (config.render.format && !VALID_FORMAT.has(config.render.format)) {
      errors.push(createError(ErrorCode.CC1003, { key: "render.format", path: config.render.format, reason: "must be one of mp4, webm, prores, gif, png, pdf" }, { location: findConfigLocation(configPath, "render.format") }));
    }

    if (config.render.quality && !VALID_QUALITY.has(config.render.quality)) {
      errors.push(createError(ErrorCode.CC1003, { key: "render.quality", path: config.render.quality, reason: "must be draft, preview, final, or lossless (or legacy high/medium/low)" }, { location: findConfigLocation(configPath, "render.quality") }));
    }

    if (config.render.codec && !VALID_CODECS.has(config.render.codec)) {
      errors.push(createError(ErrorCode.CC1003, { key: "render.codec", path: config.render.codec, reason: "must be h264, h265, av1, prores, or vp9" }, { location: findConfigLocation(configPath, "render.codec") }));
    }

    if (config.render.crf !== undefined) {
      if (!Number.isInteger(config.render.crf) || config.render.crf < 0 || config.render.crf > 63) {
        errors.push(createError(ErrorCode.CC1003, { key: "render.crf", path: String(config.render.crf), reason: "must be an integer between 0 (lossless) and 63" }, { location: findConfigLocation(configPath, "render.crf") }));
      }
    }

    if (config.render.preset && !VALID_ENCODER_PRESETS.has(config.render.preset)) {
      errors.push(createError(ErrorCode.CC1003, { key: "render.preset", path: config.render.preset, reason: "must be a valid x264/x265 preset" }, { location: findConfigLocation(configPath, "render.preset") }));
    }

    if (config.render.hardwareAcceleration && !VALID_HARDWARE_ACCEL.has(config.render.hardwareAcceleration)) {
      errors.push(createError(ErrorCode.CC1003, { key: "render.hardwareAcceleration", path: config.render.hardwareAcceleration, reason: "must be auto, nvenc, videotoolbox, qsv, or off" }, { location: findConfigLocation(configPath, "render.hardwareAcceleration") }));
    }
  }

  if (config.video) {
    const video = config.video;
    if (video.width !== undefined && (!Number.isInteger(video.width) || video.width < 2)) {
      errors.push(createError(ErrorCode.CC1003, { key: "video.width", path: String(video.width), reason: "must be an even integer >= 2" }, { location: findConfigLocation(configPath, "video.width") }));
    }
    if (video.height !== undefined && (!Number.isInteger(video.height) || video.height < 2)) {
      errors.push(createError(ErrorCode.CC1003, { key: "video.height", path: String(video.height), reason: "must be an even integer >= 2" }, { location: findConfigLocation(configPath, "video.height") }));
    }
    if (video.fps !== undefined && (video.fps <= 0 || video.fps > 240)) {
      errors.push(createError(ErrorCode.CC1003, { key: "video.fps", path: String(video.fps), reason: "must be between 0 and 240" }, { location: findConfigLocation(configPath, "video.fps") }));
    }
    if (video.aspectRatio !== undefined && !VALID_ASPECT_RATIOS.has(video.aspectRatio)) {
      errors.push(createError(ErrorCode.CC1003, { key: "video.aspectRatio", path: video.aspectRatio, reason: "must be 16:9, 9:16, 1:1, 4:3, or 21:9" }, { location: findConfigLocation(configPath, "video.aspectRatio") }));
    }
    if (video.colorSpace !== undefined && !VALID_COLOR_SPACES.has(video.colorSpace)) {
      errors.push(createError(ErrorCode.CC1003, { key: "video.colorSpace", path: video.colorSpace, reason: "must be srgb, rec709, or display-p3" }, { location: findConfigLocation(configPath, "video.colorSpace") }));
    }
  }

  if (config.images) {
    if (config.images.defaultFormat && !VALID_IMAGE_FORMATS.has(config.images.defaultFormat)) {
      errors.push(createError(ErrorCode.CC1003, { key: "images.defaultFormat", path: config.images.defaultFormat, reason: "must be png, jpg, webp, or svg" }, { location: findConfigLocation(configPath, "images.defaultFormat") }));
    }
    if (config.images.quality !== undefined && (config.images.quality < 0 || config.images.quality > 100)) {
      errors.push(createError(ErrorCode.CC1003, { key: "images.quality", path: String(config.images.quality), reason: "must be between 0 and 100" }, { location: findConfigLocation(configPath, "images.quality") }));
    }
    if (config.images.scaleFactor !== undefined && config.images.scaleFactor <= 0) {
      errors.push(createError(ErrorCode.CC1003, { key: "images.scaleFactor", path: String(config.images.scaleFactor), reason: "must be greater than 0" }, { location: findConfigLocation(configPath, "images.scaleFactor") }));
    }
  }

  if (config.dev) {
    if (config.dev.port !== undefined && (config.dev.port < 0 || config.dev.port > 65535)) {
      errors.push(createError(ErrorCode.CC1003, { key: "dev.port", path: String(config.dev.port), reason: "must be a valid port (0-65535)" }, { location: findConfigLocation(configPath, "dev.port") }));
    }
  }

  if (config.audio) {
    if (config.audio.sampleRate !== undefined && !VALID_SAMPLE_RATES.has(config.audio.sampleRate)) {
      errors.push(createError(ErrorCode.CC1003, { key: "audio.sampleRate", path: String(config.audio.sampleRate), reason: "must be 22050, 44100, 48000, or 96000" }, { location: findConfigLocation(configPath, "audio.sampleRate") }));
    }
    if (config.audio.channels !== undefined && ![1, 2].includes(config.audio.channels)) {
      errors.push(createError(ErrorCode.CC1003, { key: "audio.channels", path: String(config.audio.channels), reason: "must be 1 or 2" }, { location: findConfigLocation(configPath, "audio.channels") }));
    }
    if (config.audio.masterVolume !== undefined && (config.audio.masterVolume < 0 || config.audio.masterVolume > 1)) {
      errors.push(createError(ErrorCode.CC1003, { key: "audio.masterVolume", path: String(config.audio.masterVolume), reason: "must be between 0 and 1" }, { location: findConfigLocation(configPath, "audio.masterVolume") }));
    }
  }

  if (config.fonts) {
    for (let i = 0; i < config.fonts.length; i++) {
      const font = config.fonts[i]!;
      if (!font.family || typeof font.family !== "string") {
        errors.push(createError(ErrorCode.CC1003, { key: `fonts[${i}].family`, path: "", reason: "font family is required" }, { location: findConfigLocation(configPath, `fonts[${i}].family`) }));
      }
      if (!font.src || typeof font.src !== "string") {
        errors.push(createError(ErrorCode.CC1003, { key: `fonts[${i}].src`, path: "", reason: "font src is required" }, { location: findConfigLocation(configPath, `fonts[${i}].src`) }));
      }
    }
  }

  if (config.concurrency !== undefined) {
    if (config.concurrency !== "auto" && (typeof config.concurrency !== "number" || config.concurrency < 1 || !Number.isInteger(config.concurrency))) {
      errors.push(createError(ErrorCode.CC1003, { key: "concurrency", path: String(config.concurrency), reason: "must be 'auto' or positive integer" }, { location: findConfigLocation(configPath, "concurrency") }));
    }
  }

  if (config.logLevel && !VALID_LOG_LEVELS.has(config.logLevel)) {
    errors.push(createError(ErrorCode.CC1003, { key: "logLevel", path: config.logLevel, reason: "must be 'silent', 'error', 'warn', 'info', or 'debug'" }, { location: findConfigLocation(configPath, "logLevel") }));
  }

  if (typeof config.overwrite !== "boolean") {
    errors.push(createError(ErrorCode.CC1003, { key: "overwrite", path: String(config.overwrite), reason: "must be boolean" }, { location: findConfigLocation(configPath, "overwrite") }));
  }

  if (typeof config.gitignore !== "boolean") {
    errors.push(createError(ErrorCode.CC1003, { key: "gitignore", path: String(config.gitignore), reason: "must be boolean" }, { location: findConfigLocation(configPath, "gitignore") }));
  }

  const rawConfig = config as unknown as Record<string, unknown>;
  function checkUnknownKeys(obj: Record<string, unknown>, prefix = ""): void {
    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const isKnown =
        KNOWN_KEYS.has(fullKey) ||
        (prefix === "render" && RENDER_KEYS.has(key)) ||
        (prefix === "audio" && AUDIO_KEYS.has(key)) ||
        (prefix === "project" && PROJECT_KEYS.has(key)) ||
        (prefix === "video" && VIDEO_KEYS.has(key)) ||
        (prefix === "images" && IMAGES_KEYS.has(key)) ||
        (prefix === "dev" && DEV_KEYS.has(key)) ||
        prefix === "audio.limiter";
      if (!isKnown) {
        const suggestion = suggestKey(fullKey);
        errors.push(createError(ErrorCode.CC1002, { key: fullKey, suggestion: suggestion ?? "none" }, { location: findConfigLocation(configPath, fullKey), fixHint: suggestion ? `Did you mean ${suggestion}?` : "Remove or correct the key" }));
      }
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        checkUnknownKeys(value as Record<string, unknown>, fullKey);
      }
    }
  }
  checkUnknownKeys(rawConfig);

  return { errors, warnings };
}

export function resolveResolution(presetOrValue: string): { width: number; height: number } {
  if (RESOLUTION_PRESETS[presetOrValue]) {
    const [w, h] = RESOLUTION_PRESETS[presetOrValue]!;
    return { width: w, height: h };
  }
  const match = presetOrValue.match(/^(\d+)x(\d+)$/i);
  if (match) {
    return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  }
  return { width: 1920, height: 1080 };
}

export function resolveFps(value: number): number {
  if (VALID_FPS.has(value)) return value;
  if (Number.isInteger(value) && value >= 1 && value <= 120) return value;
  return 30;
}