import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createError, ErrorCode } from "../errors/index.js";
import { recordProcessSpawn } from "../media/instrumentation.js";

export type BinaryKind = "ffmpeg" | "ffprobe";
export type BinaryProvenance = "config" | "environment" | "system" | "installer";

export interface BinaryResolution {
  readonly kind: BinaryKind;
  readonly path: string;
  readonly version: string;
  readonly provenance: BinaryProvenance;
}

export interface BinaryResolverConfig {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly binaries?: {
    readonly ffmpegPath?: string;
    readonly ffprobePath?: string;
  };
  readonly root?: string;
}

export interface ResolveBinaryOptions {
  /** If false (default), does not spawn a child process to probe binary version. */
  readonly probeVersion?: boolean;
}

let activeBinaryConfig: BinaryResolverConfig = {};

export function setBinaryConfig(config: BinaryResolverConfig): void {
  activeBinaryConfig = { ...config };
}

export function getBinaryConfig(): BinaryResolverConfig {
  return activeBinaryConfig;
}

export function resetBinaryConfig(): void {
  activeBinaryConfig = {};
}

function executable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const versionCache = new Map<string, string>();
const binaryResolutionCache = new Map<string, BinaryResolution>();

export function resetBinaryCache(): void {
  versionCache.clear();
  binaryResolutionCache.clear();
}

export function versionOf(path: string, kind: BinaryKind): string {
  const cached = versionCache.get(path);
  if (cached !== undefined) return cached;
  try {
    recordProcessSpawn();
    const result = spawnSync(path, ["-hide_banner", "-version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    if (result.error || result.status !== 0) {
      versionCache.set(path, "unknown");
      return "unknown";
    }
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = text.match(new RegExp(`${kind} version ([^\\s]+)`, "i"));
    const v = match?.[1] ?? "unknown";
    versionCache.set(path, v);
    return v;
  } catch {
    versionCache.set(path, "unknown");
    return "unknown";
  }
}

function systemPath(kind: BinaryKind): string | null {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(command, [kind], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (result.error || result.status !== 0) return null;
    const path = `${result.stdout ?? ""}`.split(/\r?\n/)[0]?.trim();
    return path && executable(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolution order:
 * 1. explicit config path (cinecode.config.ts `binaries.ffmpegPath` / `ffmpegPath`)
 * 2. explicit environment override (e.g. `CINECODE_FFMPEG_PATH`)
 * 3. system PATH (`where` / `which`)
 * 4. documented installer fallback (@ffmpeg-installer / @ffprobe-installer)
 *
 * An invalid configured or environment path is an immediate error with a fix hint, never a silent fallback.
 */
export function resolveBinary(
  kind: BinaryKind,
  config: BinaryResolverConfig = {},
  options: ResolveBinaryOptions = {},
): BinaryResolution {
  const merged: BinaryResolverConfig = {
    ...activeBinaryConfig,
    ...config,
    binaries: {
      ...activeBinaryConfig.binaries,
      ...config.binaries,
    },
  };

  const projectRoot = merged.root ?? process.cwd();
  const configured = kind === "ffmpeg"
    ? (merged.binaries?.ffmpegPath ?? merged.ffmpegPath)
    : (merged.binaries?.ffprobePath ?? merged.ffprobePath);
  const environmentName = kind === "ffmpeg" ? "CINECODE_FFMPEG_PATH" : "CINECODE_FFPROBE_PATH";
  const envVal = process.env[environmentName];

  const cacheKey = `${kind}:${configured ?? ""}:${envVal ?? ""}:${projectRoot}`;
  if (!options.probeVersion) {
    const cached = binaryResolutionCache.get(cacheKey);
    if (cached) return cached;
  }

  let result: BinaryResolution;

  // 1. Explicit config path
  if (configured !== undefined && configured.trim() !== "") {
    const resolvedPath = resolve(projectRoot, configured);
    if (!executable(resolvedPath)) {
      throw createError(ErrorCode.CC7004, {
        reason: `Configured ${kind} binary is not executable: ${resolvedPath}. Verify ${kind}Path in cinecode.config.ts.`,
      });
    }
    result = {
      kind,
      path: resolvedPath,
      version: options.probeVersion ? versionOf(resolvedPath, kind) : "unprobed",
      provenance: "config",
    };
  } else if (envVal !== undefined && envVal.trim() !== "") {
    // 2. Explicit environment override
    const resolvedPath = resolve(envVal);
    if (!executable(resolvedPath)) {
      throw createError(ErrorCode.CC7004, {
        reason: `Environment ${kind} binary from ${environmentName} is not executable: ${resolvedPath}. Verify the path in ${environmentName}.`,
      });
    }
    result = {
      kind,
      path: resolvedPath,
      version: options.probeVersion ? versionOf(resolvedPath, kind) : "unprobed",
      provenance: "environment",
    };
  } else {
    // 3. System PATH lookup
    const system = systemPath(kind);
    if (system) {
      result = {
        kind,
        path: resolve(system),
        version: options.probeVersion ? versionOf(resolve(system), kind) : "unprobed",
        provenance: "system",
      };
    } else {
      // 4. Documented installer fallback
      try {
        const req = createRequire(import.meta.url);
        const moduleName = kind === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe";
        const installed = req(moduleName) as { path?: string; version?: string };
        if (installed.path && executable(installed.path)) {
          const resolvedPath = resolve(installed.path);
          result = {
            kind,
            path: resolvedPath,
            version: options.probeVersion
              ? (installed.version ?? versionOf(resolvedPath, kind))
              : "unprobed",
            provenance: "installer",
          };
        } else {
          throw createError(ErrorCode.CC7004, {
            reason: `${kind} binary not found. Install ${kind} on PATH, configure binaries in cinecode.config.ts, or set ${environmentName}.`,
          });
        }
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === ErrorCode.CC7004) {
          throw err;
        }
        throw createError(ErrorCode.CC7004, {
          reason: `${kind} binary not found. Install ${kind} on PATH, configure binaries in cinecode.config.ts, or set ${environmentName}.`,
        });
      }
    }
  }

  if (!options.probeVersion) {
    binaryResolutionCache.set(cacheKey, result);
  }
  return result;
}
