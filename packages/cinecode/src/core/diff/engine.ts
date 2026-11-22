import type { Composition } from "../types/index.js";

export type DiffChangeType =
  | "clip_added"
  | "clip_removed"
  | "clip_moved"
  | "clip_modified"
  | "effect_added"
  | "effect_removed"
  | "effect_reordered"
  | "track_hierarchy_changed"
  | "composition_property_changed";

export interface SemanticDiffEntry {
  type: DiffChangeType;
  entityId: string;
  name?: string;
  track?: string;
  description: string;
  oldValue?: unknown;
  newValue?: unknown;
  deltaSeconds?: number;
}

export interface CompositionSemanticDiff {
  compositionA: string;
  compositionB: string;
  durationA: number;
  durationB: number;
  changes: SemanticDiffEntry[];
  summary: {
    added: number;
    removed: number;
    moved: number;
    modified: number;
  };
}

interface NormalizedClip {
  id: string;
  name: string;
  type: string;
  track: string;
  start: number;
  duration: number;
  effects: readonly unknown[];
  raw: unknown;
}

function extractClips(comp: Composition): NormalizedClip[] {
  const result: NormalizedClip[] = [];
  const legacyComp = comp as unknown as { clips?: Array<{ track?: string; id?: string; name?: string; type?: string; start?: number; duration?: number; effects?: readonly unknown[] }> };
  if (legacyComp.clips && Array.isArray(legacyComp.clips)) {
    for (let i = 0; i < legacyComp.clips.length; i++) {
      const c = legacyComp.clips[i]!;
      const track = c.track || "default";
      const id = c.id || `${track}:${c.type || "clip"}:${i}`;
      result.push({
        id,
        name: c.name || c.id || c.type || `clip-${i}`,
        type: c.type || "clip",
        track,
        start: Number(c.start ?? 0),
        duration: Number(c.duration ?? 5),
        effects: c.effects || [],
        raw: c,
      });
    }
  } else if (comp.rootTimeline?.tracks) {
    let i = 0;
    for (const track of comp.rootTimeline.tracks) {
      const trackName = track.name || track.kind || "default";
      for (const c of track.clips) {
        const cRecord = c as unknown as Record<string, unknown>;
        const id = (cRecord.id as string | undefined) || `${trackName}:${cRecord.type || "clip"}:${i}`;
        result.push({
          id,
          name: (cRecord.name as string | undefined) || (cRecord.id as string | undefined) || (cRecord.type as string | undefined) || `clip-${i}`,
          type: (cRecord.type as string | undefined) || "clip",
          track: trackName,
          start: Number(cRecord.start ?? 0),
          duration: Number(cRecord.duration ?? 5),
          effects: (cRecord.effects as readonly unknown[] | undefined) || [],
          raw: c,
        });
        i++;
      }
    }
  }
  return result;
}

export function diffCompositions(
  compA: Composition,
  compB: Composition,
  nameA = "Composition A",
  nameB = "Composition B",
): CompositionSemanticDiff {
  const changes: SemanticDiffEntry[] = [];
  const durationA = typeof compA.duration === "number" ? compA.duration : Number(compA.duration ?? 0);
  const durationB = typeof compB.duration === "number" ? compB.duration : Number(compB.duration ?? 0);

  if (durationA !== durationB) {
    changes.push({
      type: "composition_property_changed",
      entityId: "duration",
      description: `Composition duration changed from ${durationA}s to ${durationB}s (Δ ${(durationB - durationA).toFixed(2)}s)`,
      oldValue: durationA,
      newValue: durationB,
      deltaSeconds: durationB - durationA,
    });
  }

  if (compA.width !== compB.width || compA.height !== compB.height) {
    changes.push({
      type: "composition_property_changed",
      entityId: "resolution",
      description: `Canvas resolution changed from ${compA.width}x${compA.height} to ${compB.width}x${compB.height}`,
      oldValue: `${compA.width}x${compA.height}`,
      newValue: `${compB.width}x${compB.height}`,
    });
  }

  if (compA.fps !== compB.fps) {
    changes.push({
      type: "composition_property_changed",
      entityId: "fps",
      description: `Framerate changed from ${compA.fps}fps to ${compB.fps}fps`,
      oldValue: compA.fps,
      newValue: compB.fps,
    });
  }

  const clipsA = new Map<string, NormalizedClip>();
  for (const clip of extractClips(compA)) {
    clipsA.set(clip.id, clip);
  }

  const clipsB = new Map<string, NormalizedClip>();
  for (const clip of extractClips(compB)) {
    clipsB.set(clip.id, clip);
  }

  let added = 0;
  let removed = 0;
  let moved = 0;
  let modified = 0;

  for (const [key, clipA] of clipsA.entries()) {
    const clipB = clipsB.get(key);
    if (!clipB) {
      changes.push({
        type: "clip_removed",
        entityId: key,
        name: clipA.name,
        track: clipA.track,
        description: `Clip '${clipA.name}' (${clipA.type}) removed from track '${clipA.track}'`,
        oldValue: clipA.raw,
      });
      removed++;
      continue;
    }

    if (clipA.start !== clipB.start || clipA.duration !== clipB.duration) {
      const deltaStart = clipB.start - clipA.start;
      const deltaDur = clipB.duration - clipA.duration;
      changes.push({
        type: "clip_moved",
        entityId: key,
        name: clipB.name,
        track: clipB.track,
        description: `Clip '${clipB.name}' shifted start: ${clipA.start}s -> ${clipB.start}s (Δ ${deltaStart >= 0 ? "+" : ""}${deltaStart.toFixed(2)}s), duration: ${clipA.duration}s -> ${clipB.duration}s (Δ ${deltaDur >= 0 ? "+" : ""}${deltaDur.toFixed(2)}s)`,
        oldValue: { start: clipA.start, duration: clipA.duration },
        newValue: { start: clipB.start, duration: clipB.duration },
        deltaSeconds: deltaStart,
      });
      moved++;
    }

    if (clipA.track !== clipB.track) {
      changes.push({
        type: "track_hierarchy_changed",
        entityId: key,
        description: `Clip '${clipB.name}' moved from track '${clipA.track}' to '${clipB.track}'`,
        oldValue: clipA.track,
        newValue: clipB.track,
      });
      modified++;
    }

    const effectsA = clipA.effects;
    const effectsB = clipB.effects;

    if (effectsA.length !== effectsB.length || effectsA.some((e, i) => e.type !== effectsB[i]?.type)) {
      changes.push({
        type: "effect_added",
        entityId: `${key}:effects`,
        name: clipB.name,
        description: `Effects chain modified on '${clipB.name}': [${effectsA.map((e) => e.type).join(", ")}] -> [${effectsB.map((e) => e.type).join(", ")}]`,
        oldValue: effectsA,
        newValue: effectsB,
      });
      modified++;
    }
  }

  for (const [key, clipB] of clipsB.entries()) {
    if (!clipsA.has(key)) {
      changes.push({
        type: "clip_added",
        entityId: key,
        name: clipB.name,
        track: clipB.track,
        description: `Clip '${clipB.name}' (${clipB.type}) added at ${clipB.start}s on track '${clipB.track}'`,
        newValue: clipB.raw,
      });
      added++;
    }
  }

  return {
    compositionA: nameA,
    compositionB: nameB,
    durationA,
    durationB,
    changes,
    summary: { added, removed, moved, modified },
  };
}

export function formatDiffMarkdown(diff: CompositionSemanticDiff): string {
  const lines: string[] = [
    `# Composition Semantic Diff: ${diff.compositionA} vs ${diff.compositionB}`,
    ``,
    `**Summary**: +${diff.summary.added} added, -${diff.summary.removed} removed, ~${diff.summary.moved} moved, *${diff.summary.modified} modified`,
    ``,
    `| Type | Entity | Track | Description |`,
    `| --- | --- | --- | --- |`,
  ];

  for (const c of diff.changes) {
    const glyph = c.type === "clip_added" ? "🟢 Added" : c.type === "clip_removed" ? "🔴 Removed" : c.type === "clip_moved" ? "🟡 Moved" : "🔵 Modified";
    lines.push(`| ${glyph} | \`${c.entityId}\` | ${c.track || "-"} | ${c.description} |`);
  }

  return lines.join("\n");
}

