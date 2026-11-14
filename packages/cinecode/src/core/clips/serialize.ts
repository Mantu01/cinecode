import type { Composition } from "../types/composition.js";
import { CinecodeError, AUTHORING_CODES, authoringIssue } from "../validation/errors.js";

/**
 * Deterministic composition serialization, deserialization, and diffing.
 *
 * - `serializeComposition` produces stable JSON: keys are emitted in a
 *   deterministic order so the same composition always serializes identically.
 * - `deserializeComposition` parses that JSON back into a typed composition,
 *   rejecting malformed input with a structured error.
 * - `diffCompositions` reports added, removed, and changed paths between two
 *   compositions, which is useful for change detection in dev tooling.
 */

export function serializeComposition(composition: Composition, pretty = false): string {
  return JSON.stringify(sortKeys(composition), null, pretty ? 2 : undefined);
}

export function deserializeComposition(json: string): Composition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw compositionError(`Composition JSON is not parseable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertComposition(parsed);
}

function compositionError(message: string): CinecodeError {
  return new CinecodeError(authoringIssue(AUTHORING_CODES.invalidComposition, message));
}

export interface CompositionDiffEntry {
  readonly path: string;
  readonly kind: "added" | "removed" | "changed";
  readonly from?: unknown;
  readonly to?: unknown;
}

export function diffCompositions(from: Composition, to: Composition): readonly CompositionDiffEntry[] {
  const out: CompositionDiffEntry[] = [];
  diffValues("", sortKeys(from), sortKeys(to), out);
  return out;
}

function assertComposition(value: unknown): Composition {
  if (typeof value !== "object" || value === null) {
    throw compositionError("Composition must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["name", "width", "height", "fps", "rootTimeline"] as const) {
    if (!(key in record)) {
      throw compositionError(`Composition is missing required field "${key}"`);
    }
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw compositionError('Composition "name" must be a non-empty string');
  }
  for (const key of ["width", "height", "fps"] as const) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] <= 0) {
      throw compositionError(`Composition "${key}" must be a positive number`);
    }
  }
  if (typeof record.rootTimeline !== "object" || record.rootTimeline === null) {
    throw compositionError('Composition "rootTimeline" must be an object');
  }
  return record as unknown as Composition;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
    return sorted;
  }
  return value;
}

function diffValues(path: string, from: unknown, to: unknown, out: CompositionDiffEntry[]): void {
  if (Object.is(from, to)) return;
  const bothObjects =
    typeof from === "object" && from !== null && typeof to === "object" && to !== null && Array.isArray(from) === Array.isArray(to);
  if (bothObjects) {
    if (Array.isArray(from) && Array.isArray(to)) {
      const length = Math.max(from.length, to.length);
      for (let i = 0; i < length; i += 1) {
        const childPath = `${path}[${i}]`;
        if (i >= from.length) out.push({ path: childPath, kind: "added", to: to[i] });
        else if (i >= to.length) out.push({ path: childPath, kind: "removed", from: from[i] });
        else diffValues(childPath, from[i], to[i], out);
      }
      return;
    }
    const fromRecord = from as Record<string, unknown>;
    const toRecord = to as Record<string, unknown>;
    const keys = new Set([...Object.keys(fromRecord), ...Object.keys(toRecord)]);
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key;
      const inFrom = key in fromRecord;
      const inTo = key in toRecord;
      if (!inFrom) out.push({ path: childPath, kind: "added", to: toRecord[key] });
      else if (!inTo) out.push({ path: childPath, kind: "removed", from: fromRecord[key] });
      else diffValues(childPath, fromRecord[key], toRecord[key], out);
    }
    return;
  }
  if (!Object.is(from, to)) out.push({ path, kind: "changed", from, to });
}
