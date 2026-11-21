import type { FullPlatformPreset } from "./platform-presets.js";

export interface FileSizeCompliance {
  readonly compliant: boolean;
  readonly limitBytes?: number;
  readonly actualBytes: number;
  readonly message?: string;
}

/** Compares an encoded size against the preset's upload cap. */
export function checkFileSizeCompliance(fileSizeBytes: number, preset: FullPlatformPreset | null): FileSizeCompliance {
  if (!preset?.maxFileSizeMB) return { compliant: true, actualBytes: fileSizeBytes };
  const limitBytes = preset.maxFileSizeMB * 1024 * 1024;
  if (fileSizeBytes <= limitBytes) return { compliant: true, limitBytes, actualBytes: fileSizeBytes };
  const actualMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
  return {
    compliant: false,
    limitBytes,
    actualBytes: fileSizeBytes,
    message: `[CC8001] output is ${actualMb} MB, above the ${preset.label} limit of ${preset.maxFileSizeMB} MB — raise CRF or lower the resolution`,
  };
}
