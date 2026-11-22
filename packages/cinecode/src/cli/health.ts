import { Command } from "commander";
import { doctorCommand } from "./doctor.js";
import {
  collectHealthReport,
  type SystemHealthReport,
  type FfmpegHealth,
  type NodeHealth,
  type WorkerHealth,
  type DiskHealth,
  type GpuHealth,
} from "./health-collector.js";
import { findCommand, buildCommanderCommand } from "./command-registry.js";

export type {
  SystemHealthReport,
  FfmpegHealth,
  NodeHealth,
  WorkerHealth,
  DiskHealth,
  GpuHealth,
};

export async function collectHealth(cacheDir = ".cinecode/cache"): Promise<SystemHealthReport> {
  return collectHealthReport(null, { cacheDir });
}

export async function healthCommand(options: { cache?: string; json?: boolean; strict?: boolean } = {}): Promise<void> {
  await doctorCommand({
    cache: options.cache,
    json: options.json ?? true,
    strict: options.strict,
  });
}

export function createHealthCommand(): Command {
  const spec = findCommand("doctor");
  if (!spec) throw new Error("Command 'doctor' not found in registry");
  return buildCommanderCommand(spec);
}
