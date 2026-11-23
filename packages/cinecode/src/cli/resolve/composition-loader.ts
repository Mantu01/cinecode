import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { isUserModuleFile, loadUserModuleNamespace } from "../../loader/index.js";
import type { Composition } from "../../core/types/index.js";
import { createError, ErrorCode } from "../../errors/index.js";

function assertComposition(value: unknown, path: string): Composition {
  const composition = value as Composition | null | undefined;
  if (!composition || typeof composition !== "object") {
    throw createError(
      ErrorCode.CC3008,
      { path, expected: "a composition object" },
      { location: { file: path }, fixHint: "A config file is not a composition. Pass a composition module or use --timeline/--scene." },
    );
  }
  if (typeof composition.width !== "number" || composition.width <= 0) {
    throw createError(ErrorCode.CC3008, { path, expected: "a composition with declared 'width'" }, { location: { file: path } });
  }
  if (typeof composition.height !== "number" || composition.height <= 0) {
    throw createError(ErrorCode.CC3008, { path, expected: "a composition with declared 'height'" }, { location: { file: path } });
  }
  if (typeof composition.fps !== "number" || composition.fps <= 0) {
    throw createError(ErrorCode.CC3008, { path, expected: "a composition with declared 'fps'" }, { location: { file: path } });
  }
  const hasDuration =
    (typeof composition.duration === "number" && composition.duration > 0) ||
    (typeof composition.contentDuration === "number" && composition.contentDuration > 0);
  if (!hasDuration) {
    throw createError(ErrorCode.CC3008, { path, expected: "a composition with declared 'duration'" }, { location: { file: path } });
  }
  if (!composition.rootTimeline || typeof composition.rootTimeline !== "object" || !Array.isArray(composition.rootTimeline.tracks)) {
    throw createError(
      ErrorCode.CC3008,
      { path, expected: "a composition with rootTimeline.tracks" },
      { location: { file: path } },
    );
  }
  return composition;
}

/** Loads one composition file or an array of them; a config object is rejected. */
export async function loadComposition(file: string): Promise<Composition[]> {
  const resolvedPath = resolve(file);
  if (isUserModuleFile(resolvedPath)) {
    const module = await loadUserModuleNamespace<Record<string, unknown>>(resolvedPath, dirname(resolvedPath));
    const raw = module.main ?? module.default ?? module;
    const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
    return toCompositions(value, resolvedPath);
  }
  const ext = file.split(".").pop()?.toLowerCase();
  if (ext === "json") {
    try {
      return toCompositions(JSON.parse(readFileSync(file, "utf-8")), resolvedPath);
    } catch (error) {
      if (typeof (error as { code?: unknown }).code === "string") throw error;
      throw createError(ErrorCode.CC1006, { path: resolvedPath, reason: error instanceof Error ? error.message : String(error) }, { location: { file: resolvedPath }, cause: error });
    }
  }
  throw createError(ErrorCode.CC1007, { path: resolvedPath }, { location: { file: resolvedPath } });
}

function toCompositions(value: unknown, path: string): Composition[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw createError(ErrorCode.CC3008, { path, expected: "at least one composition" }, { location: { file: path } });
    }
    return value.map((item) => assertComposition(item, path));
  }
  return [assertComposition(value, path)];
}

export function selectComposition(compositions: Composition[], name?: string): Composition {
  if (name) {
    const found = compositions.find((composition) => composition.name === name);
    if (!found) {
      const available = compositions.map((composition) => composition.name).join(", ") || "none";
      throw createError(ErrorCode.CC3007, { kind: "composition", id: name, available });
    }
    return found;
  }
  if (compositions.length === 1) return compositions[0]!;
  throw createError(ErrorCode.CC1012, { reason: `Multiple compositions found (${compositions.map((composition) => composition.name).join(", ")}), specify --composition` });
}
