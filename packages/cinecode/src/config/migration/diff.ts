import type { ConfigDiffEntry, ConfigObject } from "./types.js";

export function flattenPaths(obj: ConfigObject, prefix = ""): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const sub = flattenPaths(v as ConfigObject, full);
      for (const [sk, sv] of sub.entries()) {
        map.set(sk, sv);
      }
    } else {
      map.set(full, v);
    }
  }
  return map;
}

export function computeConfigDiff(original: ConfigObject, transformed: ConfigObject): ConfigDiffEntry[] {
  const diff: ConfigDiffEntry[] = [];
  const origPaths = flattenPaths(original);
  const transPaths = flattenPaths(transformed);

  for (const [key, origVal] of origPaths.entries()) {
    if (!transPaths.has(key)) {
      // Check if value moved to another key
      let movedTo: string | null = null;
      for (const [tKey, tVal] of transPaths.entries()) {
        if (!origPaths.has(tKey) && JSON.stringify(tVal) === JSON.stringify(origVal)) {
          movedTo = tKey;
          break;
        }
      }
      if (movedTo) {
        diff.push({ key, action: "moved", from: origVal, to: transPaths.get(movedTo), description: `Moved '${key}' to '${movedTo}'` });
      } else {
        diff.push({ key, action: "removed", from: origVal, description: `Removed '${key}'` });
      }
    } else {
      const transVal = transPaths.get(key);
      if (JSON.stringify(origVal) !== JSON.stringify(transVal)) {
        diff.push({
          key,
          action: "modified",
          from: origVal,
          to: transVal,
          description: `${key}: ${JSON.stringify(origVal)} -> ${JSON.stringify(transVal)}`,
        });
      }
    }
  }

  for (const [key, transVal] of transPaths.entries()) {
    if (!origPaths.has(key)) {
      const alreadyReportedMove = diff.some((entry) => entry.action === "moved" && entry.description.includes(`to '${key}'`));
      if (!alreadyReportedMove) {
        diff.push({ key, action: "added", to: transVal, description: `Added '${key}': ${JSON.stringify(transVal)}` });
      }
    }
  }

  return diff;
}

export function formatDiffSummary(diff: ConfigDiffEntry[]): string {
  if (diff.length === 0) return "No schema changes detected.";
  return diff.map((entry) => `  • ${entry.description}`).join("\n");
}
