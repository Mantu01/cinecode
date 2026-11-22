import type { MainManifest } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";
import { validateManifestShape } from "../config/zod-schema.js";

export const MANIFEST_COLLECTIONS = ["images", "audio", "scenes", "timelines"] as const;

const DEFINITIONS = new WeakSet<object>();
let shapeValidations = 0;

export function manifestShapeValidationCount(): number {
  return shapeValidations;
}

export function deepFreezeManifest<T extends MainManifest>(manifest: T): Readonly<T> {
  if (!manifest || typeof manifest !== "object") return manifest;
  for (const col of MANIFEST_COLLECTIONS) {
    const list = (manifest as Record<string, unknown>)[col];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") {
          Object.freeze(item);
        }
      }
      Object.freeze(list);
    }
  }
  return Object.freeze(manifest);
}

/** Describes what the entry file exported, in authoring terms. */
export function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "a named-only export (no default export)";
  if (value instanceof Promise || (typeof value === "object" && typeof (value as { then?: unknown }).then === "function")) {
    return "a promise";
  }
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (typeof value === "function") return "a function";
  if (typeof value !== "object") return `a primitive (${typeof value})`;
  const record = value as Record<string, unknown>;
  if ("rootTimeline" in record) return "a composition (rootTimeline)";
  if (Array.isArray(record.tracks)) return "a timeline (tracks array)";
  if (record.kind === "scene") return "a scene definition (defineScene)";
  if (record.kind === "image") return "an image definition (defineImage)";
  if (record.kind === "audio") return "an audio definition (defineAudio)";
  const keys = Object.keys(record);
  return keys.length === 0 ? "an empty object" : `an object with keys: ${keys.join(", ")}`;
}

function shapeErrors(raw: unknown): CinecodeError[] {
  shapeValidations += 1;
  return validateManifestShape(raw).errors.map((issue) => {
    const path = issue.path || "manifest";
    return createError(
      ErrorCode.CC1010,
      { path: "main.ts", reason: `${path}: ${issue.message}` },
      { fixHint: `Fix ${path} in the manifest definition; collections are images, audio, scenes and timelines.` },
    );
  });
}

/** Validates a definition at import time, exactly as defineConfig does. */
export function validateMainDefinition(manifest: unknown): MainManifest {
  const errors = shapeErrors(manifest);
  if (errors.length > 0) {
    (errors[0] as { issues?: readonly unknown[] }).issues = errors;
    throw errors[0];
  }
  const def = manifest as MainManifest;
  DEFINITIONS.add(def as object);
  return def;
}

export function markMainDefinition<T extends object>(definition: T): T {
  DEFINITIONS.add(definition);
  return definition;
}

export function isMainDefinition(value: unknown): boolean {
  return typeof value === "object" && value !== null && DEFINITIONS.has(value);
}

function carriesKnownCollection(value: Record<string, unknown>): boolean {
  return MANIFEST_COLLECTIONS.some((key) => Array.isArray(value[key]));
}

/** Accepts a branded definition or the documented raw shape; rejects everything else. */
export function assertMainContract(raw: unknown, entryPath = "main.ts"): MainManifest {
  if (isMainDefinition(raw)) return raw as MainManifest;
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    !("rootTimeline" in (raw as object)) &&
    carriesKnownCollection(raw as Record<string, unknown>)
  ) {
    return raw as MainManifest;
  }
  const error = createError(
    ErrorCode.CC1010,
    {
      path: entryPath,
      reason: `the entry file must default-export defineMain({ images, audio, scenes, timelines }), but it exported ${describeShape(raw)}`,
    },
    {
      location: { file: entryPath },
      fixHint:
        "Default-export defineMain({ images, audio, scenes, timelines }). A composition, timeline or asset definition belongs in an entry file referenced from that manifest, not in main.ts.",
    },
  );
  throw error;
}
