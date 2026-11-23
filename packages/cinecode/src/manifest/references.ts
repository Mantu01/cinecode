import type { MainManifest } from "../core/types/index.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";

export interface ReferenceGraph {
  readonly audio: ReadonlySet<string>;
  readonly scenes: ReadonlySet<string>;
  readonly timelines: ReadonlySet<string>;
  readonly overridden: ReadonlyArray<{ readonly timeline: string; readonly scene: string }>;
}

export interface ReferenceReport {
  readonly graph: ReferenceGraph;
  readonly warnings: readonly CinecodeError[];
}

/** Which entries are referenced by timelines, and which scene refs a file overrides. */
export function buildReferenceGraph(manifest: MainManifest): ReferenceGraph {
  const audio = new Set<string>();
  const scenes = new Set<string>();
  const timelines = new Set<string>();
  const overridden: Array<{ timeline: string; scene: string }> = [];
  for (const timeline of manifest.timelines ?? []) {
    timelines.add(timeline.id.toLowerCase());
    for (const ref of timeline.audioRef ?? []) audio.add(ref.toLowerCase());
    for (const ref of timeline.sceneRefs ?? []) {
      scenes.add(ref.toLowerCase());
      if (timeline.file !== undefined) overridden.push({ timeline: timeline.id, scene: ref });
    }
  }
  return { audio, scenes, timelines, overridden };
}

/** Warnings with entry ids: dead assets and references a file never compiles. */
export function referenceWarnings(manifest: MainManifest): CinecodeError[] {
  const graph = buildReferenceGraph(manifest);
  const warnings: CinecodeError[] = [];
  const reported = new Set<string>();

  const report = (kind: string, id: string, referenced: boolean, target: string): void => {
    if (referenced) return;
    const key = `${kind}:${id.toLowerCase()}`;
    if (reported.has(key)) return;
    reported.add(key);
    warnings.push(
      createError(
        ErrorCode.CC3009,
        { kind: `${kind} entry`, id },
        {
          fixHint: `No timeline references "${id}". It is still a valid standalone ${target} target, so reference it only if it belongs to a timeline.`,
          severity: "warning",
        },
      ),
    );
  };

  for (const entry of manifest.images ?? []) report("image", entry.id, false, "generate");
  for (const entry of manifest.audio ?? []) report("audio", entry.id, graph.audio.has(entry.id.toLowerCase()), "generate");
  for (const entry of manifest.scenes ?? []) report("scene", entry.id, graph.scenes.has(entry.id.toLowerCase()), "render");

  return warnings;
}
