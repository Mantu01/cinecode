import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { decodeAudioFile } from "./decode.js";
import { encodeWavBuffer } from "./muxer.js";
import type { AudioBuffer } from "./types.js";
import { createError, ErrorCode } from "../errors/index.js";

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export interface StemOptions {
  readonly stems?: readonly StemName[];
  readonly cacheDir?: string;
  readonly model?: string;
  readonly device?: "cpu" | "cuda" | "mps";
  readonly pythonPath?: string;
  readonly demucsCommand?: string;
  readonly force?: boolean;
  readonly timeoutMs?: number;
}

export interface StemResult {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly cacheDirectory: string;
  readonly stems: Readonly<Partial<Record<StemName, string>>>;
  readonly cached: boolean;
}

export interface StemAvailability {
  readonly available: boolean;
  readonly command: string | null;
  readonly description: string | null;
}

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const DEFAULT_CACHE_DIR = join(".cinecode", "cache");
const DEFAULT_MODEL = "htdemucs";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Local cache for Demucs model weights; passed to Demucs via TORCH_HOME. */
export function demucsModelCacheDir(): string {
  return join(homedir(), ".cinecode", "models");
}

export function stemCacheDirectory(cacheDir: string | undefined, sourceHash: string): string {
  return join(resolve(cacheDir ?? DEFAULT_CACHE_DIR), "stems", sourceHash);
}

export function demucsSetupGuidance(): string {
  return [
    "Stem separation requires Demucs (Meta's source separation model).",
    "Install it with: pip install demucs torch torchaudio",
    "Verify with: demucs --help",
    "Alternatively set STEM_SEPARATOR_PYTHON or pass pythonPath in StemOptions.",
  ].join(" ");
}

function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

async function candidateCommands(
  options: StemOptions,
): Promise<readonly { command: string; prefix: readonly string[] }[]> {
  const candidates: { command: string; prefix: readonly string[] }[] = [];
  if (options.demucsCommand) candidates.push({ command: options.demucsCommand, prefix: [] });
  candidates.push({ command: "demucs", prefix: [] });
  const pythonCandidates = [
    options.pythonPath,
    process.env.STEM_SEPARATOR_PYTHON,
    process.platform === "win32" ? "python" : "python3",
    "python",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const seen = new Set<string>();
  for (const python of pythonCandidates) {
    if (seen.has(python)) continue;
    seen.add(python);
    candidates.push({ command: python, prefix: ["-m", "demucs"] });
  }
  return candidates;
}

export async function detectStemSeparator(options: StemOptions = {}): Promise<StemAvailability> {
  for (const candidate of await candidateCommands(options)) {
    const result = await runProcess(candidate.command, [...candidate.prefix, "--help"], 20000);
    if (result.code === 0) {
      return {
        available: true,
        command: [candidate.command, ...candidate.prefix].join(" "),
        description: result.stdout.split("\n")[0] ?? "",
      };
    }
  }
  return { available: false, command: null, description: demucsSetupGuidance() };
}

export async function hashAudioFile(audioPath: string): Promise<string> {
  const absolute = resolve(audioPath);
  const info = await stat(absolute);
  const hash = createHash("sha256");
  hash.update(`${info.size}:${Math.round(info.mtimeMs)}`);
  hash.update(await readFile(absolute));
  return hash.digest("hex");
}

async function findStemFiles(directory: string): Promise<Map<StemName, string>> {
  const found = new Map<StemName, string>();
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stem = STEM_NAMES.find((name) => basename(entry.name, extname(entry.name)) === name);
    if (!stem) continue;
    const fullPath = join(entry.parentPath ?? directory, entry.name);
    if (!found.has(stem)) found.set(stem, fullPath);
  }
  return found;
}

function requestedStems(options: StemOptions): readonly StemName[] {
  const requested = options.stems && options.stems.length > 0 ? options.stems : STEM_NAMES;
  return STEM_NAMES.filter((stem) => requested.includes(stem));
}

export async function separateStems(
  audioPath: string,
  options: StemOptions = {},
): Promise<StemResult> {
  const absolute = resolve(audioPath);
  const sourceHash = await hashAudioFile(absolute);
  const cacheDirectory = stemCacheDirectory(options.cacheDir, sourceHash);
  const stems = requestedStems(options);
  await mkdir(cacheDirectory, { recursive: true });

  const existing: Partial<Record<StemName, string>> = {};
  let missing = 0;
  for (const stem of stems) {
    const candidate = join(cacheDirectory, `${stem}.wav`);
    const info = await stat(candidate).catch(() => null);
    if (info && !options.force) {
      existing[stem] = candidate;
    } else {
      missing += 1;
    }
  }
  if (missing === 0 && Object.keys(existing).length > 0) {
    return { sourcePath: absolute, sourceHash, cacheDirectory, stems: existing, cached: true };
  }

  const availability = await detectStemSeparator(options);
  if (!availability.available || !availability.command) {
    const fallback = await channelSplitFallback(absolute, cacheDirectory, stems).catch(() => null);
    if (fallback) {
      return { sourcePath: absolute, sourceHash, cacheDirectory, stems: fallback, cached: false };
    }
    throw createError(ErrorCode.CC5201, { reason: `Demucs is not available. ${demucsSetupGuidance()}` });
  }

  const staging = join(cacheDirectory, `.demucs-${Date.now().toString(36)}`);
  await mkdir(staging, { recursive: true });
  const [command, ...prefix] = availability.command.split(" ");
  if (!command) throw createError(ErrorCode.CC5201, { reason: `Invalid Demucs command: ${availability.command}` });

  const args = [
    ...prefix,
    "-n",
    options.model ?? DEFAULT_MODEL,
    "-o",
    staging,
    ...(options.device ? ["-d", options.device] : []),
    absolute,
  ];

  const result = await runProcess(command, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, {
    TORCH_HOME: demucsModelCacheDir(),
  });
  if (result.code !== 0) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    const reason = result.timedOut ? "timed out" : `exit code ${result.code}`;
    throw createError(ErrorCode.CC5202, {
      reason: `Demucs separation failed (${reason}): ${result.stderr.trim().slice(-800)}`,
    });
  }

  const produced = await findStemFiles(staging);
  const exported: Partial<Record<StemName, string>> = {};
  for (const stem of stems) {
    const file = produced.get(stem);
    if (!file) continue;
    const target = join(cacheDirectory, `${stem}.wav`);
    await rm(target, { force: true }).catch(() => undefined);
    await rename(file, target).catch(async () => {
      await copyFile(file, target);
      await rm(file, { force: true }).catch(() => undefined);
    });
    exported[stem] = target;
  }
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);

  if (Object.keys(exported).length === 0) {
    throw createError(ErrorCode.CC5203, { path: staging });
  }

  return { sourcePath: absolute, sourceHash, cacheDirectory, stems: exported, cached: false };
}

export async function resolveStemSource(
  audioPath: string,
  stem: StemName,
  options: StemOptions = {},
): Promise<string> {
  const result = await separateStems(audioPath, { ...options, stems: [stem] });
  const path = result.stems[stem];
  if (!path) throw createError(ErrorCode.CC5204, { stem, path: audioPath });
  return path;
}

/**
 * Fallback when Demucs is unavailable: a mid/side channel split.
 * "vocals" is the mono mid (centered content), "other" is the stereo side.
 * drums/bass cannot be isolated this way — quality is far below Demucs.
 */
async function channelSplitFallback(
  audioPath: string,
  cacheDirectory: string,
  stems: readonly StemName[],
): Promise<Partial<Record<StemName, string>>> {
  const decoded = await decodeAudioFile(audioPath, { targetSampleRate: 48000, targetChannels: 2 });
  const buffer = decoded.buffer;
  const mid = stereoToMid(buffer);
  const side = stereoToSide(buffer);
  const exported: Partial<Record<StemName, string>> = {};
  const writable: Partial<Record<StemName, AudioBuffer>> = {
    vocals: { ...buffer, channels: 1, data: mid },
    other: { ...buffer, channels: 2, data: side },
  };
  for (const stem of stems) {
    const data = writable[stem];
    if (!data) continue;
    const target = join(cacheDirectory, `${stem}.wav`);
    await writeFile(target, encodeWavBuffer(data));
    exported[stem] = target;
  }
  if (Object.keys(exported).length === 0) {
    throw createError(ErrorCode.CC5205);
  }
  return exported;
}

function stereoToMid(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const left = buffer.data[i * buffer.channels] ?? 0;
    const right = buffer.data[i * buffer.channels + 1] ?? left;
    out[i] = (left + right) / 2;
  }
  return out;
}

function stereoToSide(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length * 2);
  for (let i = 0; i < buffer.length; i += 1) {
    const left = buffer.data[i * buffer.channels] ?? 0;
    const right = buffer.data[i * buffer.channels + 1] ?? left;
    const side = (left - right) / 2;
    out[i * 2] = side;
    out[i * 2 + 1] = side;
  }
  return out;
}
