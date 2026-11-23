export type HealthSectionStatus = "PASS" | "WARN" | "FAIL" | "INFO" | "SKIPPED";

export interface HealthSection<T = unknown> {
  readonly name: string;
  readonly status: HealthSectionStatus;
  readonly message: string;
  readonly details?: T;
  readonly fixHint?: string;
  readonly fixable?: boolean;
}

export interface FfmpegHealth {
  readonly version: string;
  readonly path: string;
  readonly provenance?: string;
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
  readonly outputDir: string;
  readonly cacheFreeGb: number;
  readonly outputFreeGb: number;
  readonly ok: boolean;
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
  readonly gpu: GpuHealth;
  readonly issues: readonly string[];
}

export interface HealthReport extends SystemHealthReport {
  readonly passed: boolean;
  readonly isProject: boolean;
  readonly sections: {
    readonly runtime: HealthSection;
    readonly binaries: HealthSection;
    readonly encoders: HealthSection;
    readonly hardwareAcceleration: HealthSection;
    readonly fonts: HealthSection;
    readonly roots: HealthSection;
    readonly config: HealthSection;
    readonly manifest: HealthSection;
    readonly resources: HealthSection;
    readonly preview: HealthSection;
    readonly gitignore: HealthSection;
  };
  readonly checks: readonly HealthSection[];
  readonly notes: readonly string[];
  readonly system: {
    readonly runtime: unknown;
    readonly binaries: unknown;
    readonly hardwareAcceleration: unknown;
    readonly resources: unknown;
    readonly preview: unknown;
  };
}

export interface CollectHealthOptions {
  readonly cacheDir?: string;
  readonly requiredCodec?: string;
}
