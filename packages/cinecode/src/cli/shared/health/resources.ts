import { cpus, freemem, totalmem } from "node:os";
import { statfs } from "node:fs/promises";
import type { ProjectResolution } from "../../resolve/project-resolver.js";
import type { HealthSection } from "./types.js";

async function freeGigabytes(target: string): Promise<number> {
  try {
    const stats = await statfs(target);
    return (stats.bavail * stats.bsize) / (1024 ** 3);
  } catch {
    return 0;
  }
}

export interface ResourcesHealth {
  readonly section: HealthSection;
  readonly cpuCount: number;
  readonly recommendedWorkers: number;
  readonly totalMemoryMb: number;
  readonly cacheDir: string;
  readonly outputDir: string;
  readonly cacheFreeGb: number;
  readonly outputFreeGb: number;
  readonly diskOk: boolean;
}

export async function collectResourcesHealth(
  resolution: ProjectResolution | null | undefined,
  projectRoot: string,
  optionsCacheDir: string | undefined,
  issues: string[],
): Promise<ResourcesHealth> {
  const cpuCount = cpus().length;
  const recommendedWorkers = Math.max(1, Math.min(cpuCount, 4));
  const totalMem = Math.round(totalmem() / (1024 * 1024));
  const freeMem = Math.round(freemem() / (1024 * 1024));
  const cacheDir = resolution?.context.roots.cache ?? optionsCacheDir ?? ".cinecode/cache";
  const outputDir = resolution?.context.roots.output ?? "output";
  const [cacheFreeGb, outputFreeGb, projectFreeGb] = await Promise.all([
    freeGigabytes(cacheDir),
    freeGigabytes(outputDir),
    freeGigabytes(projectRoot),
  ]);
  const diskFreeGb = Math.max(cacheFreeGb, outputFreeGb, projectFreeGb);
  const diskOk = diskFreeGb >= 1;
  if (!diskOk) {
    issues.push("Less than 1 GB free disk space available");
  }
  return {
    cpuCount,
    recommendedWorkers,
    totalMemoryMb: totalMem,
    cacheDir,
    outputDir,
    cacheFreeGb,
    outputFreeGb,
    diskOk,
    section: {
      name: "Resources",
      status: diskOk ? "PASS" : "WARN",
      message: `${cpuCount} CPUs available (${recommendedWorkers} recommended), ${freeMem} MB system free RAM of ${totalMem} MB total, ${diskFreeGb.toFixed(1)} GB free at ${cacheDir}`,
      details: {
        concurrency: recommendedWorkers,
        cpuCount,
        systemTotalMemoryMb: totalMem,
        systemFreeMemoryMb: freeMem,
        diskFreeGb,
        diskOk,
      },
      fixHint: diskOk ? undefined : "Free up disk space on the target volume",
    },
  };
}
