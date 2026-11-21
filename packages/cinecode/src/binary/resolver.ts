import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createError, ErrorCode } from "../errors/index.js";

export type BinaryKind = "ffmpeg" | "ffprobe";

export interface BinaryResolution {
  readonly kind: BinaryKind;
  readonly path: string;
  readonly version: string;
  readonly provenance: "environment" | "config" | "system" | "installer";
}

export interface BinaryResolverConfig {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly root?: string;
}

function executable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function versionOf(path: string, kind: BinaryKind): string {
  const result = spawnSync(path, ["-hide_banner", "-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return "unknown";
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = text.match(new RegExp(`${kind} version ([^\\s]+)`, "i"));
  return match?.[1] ?? "unknown";
}

function systemPath(kind: BinaryKind): string | null {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [kind], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) return null;
  const path = `${result.stdout ?? ""}`.split(/\r?\n/)[0]?.trim();
  return path && executable(path) ? path : null;
}

export function resolveBinary(kind: BinaryKind, config: BinaryResolverConfig = {}): BinaryResolution {
  const environmentName = kind === "ffmpeg" ? "CINECODE_FFMPEG_PATH" : "CINECODE_FFPROBE_PATH";
  const configured = kind === "ffmpeg" ? config.ffmpegPath : config.ffprobePath;
  const candidates: readonly { path: string; provenance: BinaryResolution["provenance"] }[] = [
    ...(process.env[environmentName] ? [{ path: process.env[environmentName]!, provenance: "environment" as const }] : []),
    ...(configured ? [{ path: resolve(config.root ?? process.cwd(), configured), provenance: "config" as const }] : []),
  ];

  for (const candidate of candidates) {
    if (!executable(candidate.path)) {
      throw createError(ErrorCode.CC7004, {
        reason: `Configured ${kind} binary is not executable: ${candidate.path}`,
      });
    }
  }

  for (const candidate of candidates) {
    return {
      kind,
      path: resolve(candidate.path),
      version: versionOf(resolve(candidate.path), kind),
      provenance: candidate.provenance,
    };
  }

  try {
    const require = createRequire(import.meta.url);
    const moduleName = kind === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe";
    const installed = require(moduleName) as { path?: string; version?: string };
    if (installed.path && executable(installed.path)) {
      return {
        kind,
        path: resolve(installed.path),
        version: installed.version ?? versionOf(resolve(installed.path), kind),
        provenance: "installer",
      };
    }
  } catch {
    void 0;
  }

  const system = systemPath(kind);
  if (system) {
    return { kind, path: resolve(system), version: versionOf(resolve(system), kind), provenance: "system" };
  }

  throw createError(ErrorCode.CC7004, {
    reason: `${kind} binary not found. Install ${kind} on PATH or set ${environmentName}.`,
  });
}
