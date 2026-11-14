export interface ReorderableClip {
  readonly id: string;
  readonly start: number;
  readonly duration: number;
}

export interface ClipReorderState {
  readonly clipId: string;
  readonly originIndex: number;
  readonly insertIndex: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly dragging: boolean;
}

export interface ClipReorderAction {
  readonly kind: "reorder";
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface ClipDragVisual {
  readonly draggingId: string;
  readonly insertIndex: number;
  readonly lifted: boolean;
  readonly dimmedIds: readonly string[];
}

export function beginClipDrag(
  clips: readonly ReorderableClip[],
  clipId: string,
  pointer: { readonly x: number; readonly y: number },
): ClipReorderState | null {
  const originIndex = clips.findIndex((clip) => clip.id === clipId);
  if (originIndex < 0) return null;
  return {
    clipId,
    originIndex,
    insertIndex: originIndex,
    pointerX: pointer.x,
    pointerY: pointer.y,
    dragging: true,
  };
}

export function updateClipDrag(
  state: ClipReorderState,
  clips: readonly ReorderableClip[],
  pointer: { readonly x: number; readonly y: number },
  centerX = 0,
  pixelsPerSecond = 100,
): ClipReorderState {
  if (!state.dragging) return state;
  const time = Math.max(0, (pointer.x - centerX) / Math.max(1, pixelsPerSecond));
  let insertIndex = clips.length;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]!;
    if (time < clip.start + clip.duration / 2) {
      insertIndex = index;
      break;
    }
  }
  if (insertIndex > state.originIndex) insertIndex -= 1;
  return { ...state, pointerX: pointer.x, pointerY: pointer.y, insertIndex };
}

export function commitClipDrag(
  state: ClipReorderState,
  clips: readonly ReorderableClip[],
): { readonly clips: readonly ReorderableClip[]; readonly action: ClipReorderAction } | null {
  if (!state.dragging) return null;
  const before = clips.map((clip) => clip.id);
  const moved = clips.find((clip) => clip.id === state.clipId);
  if (!moved) return null;
  const without = clips.filter((clip) => clip.id !== state.clipId);
  const target = Math.max(0, Math.min(without.length, state.insertIndex));
  const ordered = [...without.slice(0, target), moved, ...without.slice(target)];
  const after = ordered.map((clip) => clip.id);
  if (before.join("|") === after.join("|")) return null;
  return { clips: ordered, action: { kind: "reorder", before, after } };
}

export function moveClipByKeyboard(
  clips: readonly ReorderableClip[],
  clipId: string,
  direction: "up" | "down",
): { readonly clips: readonly ReorderableClip[]; readonly action: ClipReorderAction } | null {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= clips.length) return null;
  const ordered = [...clips];
  const [moved] = ordered.splice(index, 1);
  if (!moved) return null;
  ordered.splice(target, 0, moved);
  return {
    clips: ordered,
    action: {
      kind: "reorder",
      before: clips.map((clip) => clip.id),
      after: ordered.map((clip) => clip.id),
    },
  };
}

export function applyReorderAction(
  clips: readonly ReorderableClip[],
  order: readonly string[],
): readonly ReorderableClip[] {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const ordered: ReorderableClip[] = [];
  for (const id of order) {
    const clip = byId.get(id);
    if (clip) ordered.push(clip);
  }
  return ordered.length === clips.length ? ordered : clips;
}

export function dragVisual(state: ClipReorderState, clips: readonly ReorderableClip[]): ClipDragVisual {
  const dimmedIds = clips.filter((clip) => clip.id !== state.clipId).map((clip) => clip.id);
  return {
    draggingId: state.clipId,
    insertIndex: state.insertIndex,
    lifted: true,
    dimmedIds,
  };
}
