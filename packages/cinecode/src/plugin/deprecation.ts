import type { PluginManifest } from "./types.js";

export interface DeprecationCheckResult {
  isDeprecated: boolean;
  isIncompatible: boolean;
  message?: string;
  replacement?: string;
}

export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < 3; i++) {
    const diff = (p1[i] ?? 0) - (p2[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkPluginDeprecation(
  manifest: PluginManifest,
  currentEngineVersion = "0.1.0",
): DeprecationCheckResult {
  let isDeprecated = false;
  let isIncompatible = false;
  let message: string | undefined;

  if (manifest.deprecated) {
    isDeprecated = true;
    message = typeof manifest.deprecated === "string" ? manifest.deprecated : `Plugin '${manifest.name}' is deprecated.`;
  }

  if (manifest.minEngineVersion && compareSemver(currentEngineVersion, manifest.minEngineVersion) < 0) {
    isIncompatible = true;
    message = `Plugin '${manifest.name}' requires minimum engine version ${manifest.minEngineVersion}, but running ${currentEngineVersion}.`;
  }

  if (manifest.maxEngineVersion && compareSemver(currentEngineVersion, manifest.maxEngineVersion) > 0) {
    isIncompatible = true;
    message = `Plugin '${manifest.name}' only supports up to engine version ${manifest.maxEngineVersion}, but running ${currentEngineVersion}.`;
  }

  return {
    isDeprecated,
    isIncompatible,
    message,
    replacement: manifest.replacement,
  };
}

export function formatDeprecationNotice(manifest: PluginManifest, result: DeprecationCheckResult): string {
  const lines = [
    `┌────────────────────────────────────────────────────────┐`,
    `│ WARNING: Deprecated Plugin Detected                   │`,
    `│ Plugin: ${manifest.name.padEnd(46)} │`,
  ];
  if (result.message) {
    lines.push(`│ ${result.message.padEnd(54)} │`);
  }
  if (manifest.deprecatedSince) {
    lines.push(`│ Deprecated since: ${manifest.deprecatedSince.padEnd(36)} │`);
  }
  if (result.replacement) {
    lines.push(`│ Recommended replacement: ${result.replacement.padEnd(29)} │`);
  }
  lines.push(`└────────────────────────────────────────────────────────┘`);
  return lines.join("\n");
}
