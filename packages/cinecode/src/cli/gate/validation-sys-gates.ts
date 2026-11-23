import { accessSync, constants, existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { checkRuntime } from "../../loader/index.js";
import { resolveProjectRoots } from "../../config/roots.js";
import { ErrorCode } from "../../errors/index.js";
import { resolveBinary } from "../../binary/resolver.js";
import type { ProjectResolution } from "../resolve/project-resolver.js";
import type { ValidationIssue } from "./validation-types.js";

export interface SysGateResult {
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

export async function runRuntimeGate(): Promise<SysGateResult> {
  const errors: ValidationIssue[] = [];
  const runtime = checkRuntime();
  if (!runtime.supported) {
    errors.push({
      code: ErrorCode.CC7001,
      severity: "error",
      gate: "runtime",
      message: `Node.js ${runtime.version} is not supported (minimum: ${runtime.minimum})`,
      fix: `Upgrade Node.js to >= ${runtime.minimum}`,
      fixHint: `Upgrade Node.js to >= ${runtime.minimum}`,
    });
  }
  return { errors, warnings: [] };
}

export async function runCapabilityGate(resolution: ProjectResolution): Promise<SysGateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  try {
    const canvasModule = await import("@napi-rs/canvas").catch(() => null);
    if (!canvasModule) throw new Error("Canvas module (@napi-rs/canvas) not available");
    const { Canvas } = canvasModule;
    const canvas = new Canvas(10, 10);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 10, 10);
  } catch (error) {
    errors.push({
      code: ErrorCode.CC7002,
      severity: "error",
      gate: "capability",
      message: `Canvas renderer initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Ensure @napi-rs/canvas is installed and supported",
      fixHint: "Ensure @napi-rs/canvas is installed and supported",
    });
  }

  try {
    const execFileAsync = promisify(execFile);
    const ffmpeg = resolveBinary("ffmpeg", { ...resolution.config.binaries, root: resolution.root });
    const { stdout } = await execFileAsync(ffmpeg.path, ["-hide_banner", "-encoders"], { timeout: 3000 });
    const required = ["libx264"];
    const missing = required.filter((name) => !stdout.includes(name));
    if (missing.length > 0) {
      warnings.push({
        code: ErrorCode.CC7002,
        severity: "warning",
        gate: "capability",
        message: `Missing encoder capability: ${missing.join(", ")}`,
        fix: "Install ffmpeg with libx264 support",
        fixHint: "Install ffmpeg with libx264 support",
      });
    }
  } catch (error) {
    warnings.push({
      code: ErrorCode.CC7002,
      severity: "warning",
      gate: "capability",
      message: `Encoder capability probe skipped: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Ensure ffmpeg is installed and configured",
      fixHint: "Ensure ffmpeg is installed and configured",
    });
  }

  return { errors, warnings };
}

export async function runResourcesGate(resolution: ProjectResolution): Promise<SysGateResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const roots = resolveProjectRoots(resolution.root, resolution.config);

  const checkWritable = (dir: string): boolean => {
    try {
      if (existsSync(dir)) {
        accessSync(dir, constants.W_OK);
        return true;
      }
      let current = dirname(dir);
      while (!existsSync(current) && current !== dirname(current)) {
        current = dirname(current);
      }
      accessSync(current, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };

  for (const [key, dir] of [["outputDir", roots.output], ["cacheDir", roots.cache]] as const) {
    if (!checkWritable(dir)) {
      errors.push({
        code: ErrorCode.CC1003,
        severity: "error",
        gate: "resources",
        file: dir,
        message: `Directory "${key}" is not writable: ${dir}`,
        fix: `Ensure write permissions for ${dir}`,
        fixHint: `Ensure write permissions for ${dir}`,
      });
    }
  }

  try {
    const stats = await statfs(resolution.root);
    const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);
    if (freeGB < 1) {
      warnings.push({
        code: ErrorCode.CC7003,
        severity: "warning",
        gate: "resources",
        message: `Low disk space on project volume: ${freeGB.toFixed(2)} GB free (< 1 GB)`,
        fix: "Free up disk space on the project volume",
        fixHint: "Free up disk space on the project volume",
      });
    }
  } catch {
    // Note: statfs not available on some environments
  }

  return { errors, warnings };
}
