import { Command } from "commander";
import { spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import { checkRuntime } from "../loader/index.js";
import { EXIT_CODES, ExitSignal } from "./exit-codes.js";

export interface FfmpegHealth {
  readonly version: string;
  readonly path: string;
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

export interface NetworkHealth {
  readonly reachable: boolean;
  readonly host: string;
  readonly latencyMs: number | null;
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
  readonly network: NetworkHealth;
  readonly gpu: GpuHealth;
  readonly issues: readonly string[];
}


const NETWORK_PROBE_HOST = "https://registry.npmjs.org/-/ping";

function runBinary(path: string, args: readonly string[], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const child = spawn(path, [...args], { windowsHide: true });
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolvePromise(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(code === 0 ? output : null);
    });
  });
}

async function probeFfmpeg(): Promise<FfmpegHealth> {
  const binaryPath = ffmpegStatic.path;
  const banner = await runBinary(binaryPath, ["-hide_banner", "-version"]);
  if (!banner) {
    return { version: "not found", path: binaryPath, h264: false, hevc: false, av1: false, vp9: false };
  }
  const version = /ffmpeg version (\S+)/.exec(banner)?.[1] ?? "unknown";
  const encoders = (await runBinary(binaryPath, ["-hide_banner", "-encoders"])) ?? "";
  return {
    version,
    path: binaryPath,
    h264: /\blibx264\b|\bh264_\w+/.test(encoders),
    hevc: /\blibx265\b|\bhevc_\w+/.test(encoders),
    av1: /\blibsvtav1\b|\blibaom-av1\b|\blibrav1e\b|\bav1_\w+/.test(encoders),
    vp9: /\blibvpx-vp9\b|\bvp9_\w+/.test(encoders),
  };
}

function probeNode(): NodeHealth {
  const runtime = checkRuntime();
  return {
    version: runtime.version,
    compatible: runtime.supported,
    minimum: runtime.minimum,
    loaderMode: runtime.loaderMode,
  };
}

function probeWorkers(): WorkerHealth {
  const available = cpus().length;
  return {
    available,
    recommended: Math.max(1, Math.min(available, 4)),
    totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
  };
}

async function freeGigabytes(target: string): Promise<number> {
  try {
    const stats = await statfs(target);
    return (stats.bavail * stats.bsize) / 1024 ** 3;
  } catch {
    return 0;
  }
}

async function probeDisk(cacheDir: string): Promise<DiskHealth> {
  const [cacheFreeGb, tempFreeGb] = await Promise.all([freeGigabytes(cacheDir), freeGigabytes(resolve("."))]);
  return {
    cacheDir: `${cacheFreeGb.toFixed(1)}GB free`,
    tempDir: `${tempFreeGb.toFixed(1)}GB free`,
    cacheFreeGb,
    tempFreeGb,
    ok: cacheFreeGb >= 1,
  };
}

async function probeNetwork(): Promise<NetworkHealth> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(NETWORK_PROBE_HOST, { method: "HEAD", signal: controller.signal });
    return { reachable: response.ok, host: "registry.npmjs.org", latencyMs: Date.now() - started };
  } catch {
    return { reachable: false, host: "registry.npmjs.org", latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

async function probeGpu(): Promise<GpuHealth> {
  try {
    const module = await import("@napi-rs/canvas");
    const CanvasCtor = module.Canvas;
    const canvas = new CanvasCtor(8, 8);
    const context = canvas.getContext("2d");
    const accelerated = typeof (context as { isAccelerated?: boolean }).isAccelerated === "boolean";
    return { available: true, acceleratedCanvas: accelerated, backend: "skia" };
  } catch {
    return { available: false, acceleratedCanvas: false, backend: "software" };
  }
}

export async function collectHealth(cacheDir = ".cinecode/cache"): Promise<SystemHealthReport> {
  const [ffmpeg, diskSpace, network, gpu] = await Promise.all([
    probeFfmpeg(),
    probeDisk(cacheDir),
    probeNetwork(),
    probeGpu(),
  ]);
  const node = probeNode();
  const workers = probeWorkers();

  const issues: string[] = [];
  if (ffmpeg.version === "not found") issues.push("ffmpeg binary is not available");
  if (!ffmpeg.h264) issues.push("ffmpeg build has no h264 encoder");
  if (!node.compatible) issues.push(`Node.js ${node.version} is below the required ${node.minimum}`);
  if (!diskSpace.ok) issues.push("less than 1GB free in the cache volume");
  if (!gpu.available) issues.push("canvas renderer could not be initialized");

  return { ffmpeg, node, workers, diskSpace, network, gpu, issues };
}

function formatHealth(report: SystemHealthReport): string {
  const lines: string[] = [];
  lines.push("Cinecode health");
  lines.push("---------------");
  lines.push(`ffmpeg        ${report.ffmpeg.version} (h264=${report.ffmpeg.h264} hevc=${report.ffmpeg.hevc} av1=${report.ffmpeg.av1} vp9=${report.ffmpeg.vp9})`);
  lines.push(`node          ${report.node.version} (${report.node.compatible ? "compatible" : "unsupported"}, ${report.node.loaderMode})`);
  lines.push(`workers       ${report.workers.available} available (recommended ${report.workers.recommended})`);
  lines.push(`memory        ${report.workers.totalMemoryMb} MB total`);
  lines.push(`disk cache    ${report.diskSpace.cacheDir}`);
  lines.push(`disk temp     ${report.diskSpace.tempDir}`);
  lines.push(`network       ${report.network.reachable ? `reachable (${report.network.latencyMs} ms)` : "unreachable"}`);
  lines.push(`gpu           ${report.gpu.available ? `available (${report.gpu.backend})` : "not available"}`);
  if (report.issues.length > 0) {
    lines.push("");
    for (const issue of report.issues) lines.push(`⚠ ${issue}`);
  }
  return lines.join("\n");
}

export function createHealthCommand(): Command {
  return new Command("health")
    .description("Report ffmpeg, Node, worker, disk, network and GPU health")
    .option("--cache <dir>", "Cache directory to inspect")
    .option("--strict", "Exit non-zero when any issue is detected")
    .action(async (options: { cache?: string; json?: boolean; strict?: boolean }) => {
      const report = await collectHealth(options.cache ?? ".cinecode/cache");
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatHealth(report));
      }
      if (options.strict && report.issues.length > 0) throw new ExitSignal(EXIT_CODES.environment);
    });
}
