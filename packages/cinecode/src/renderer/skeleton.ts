import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type { Point, Stroke } from "./shapes/primitives.js";

/**
 * Stick-figure and skeletal drawing primitives.
 *
 * These are low-level, code-defined drawing primitives — not a character rig
 * package. A skeleton is a hierarchy of bones, each a line segment with a rest
 * angle relative to its parent. A pose maps bone names to angle overrides.
 * Posing is angle-based, so authors can drive it directly from math, keyframes,
 * or motion-by-math helpers.
 *
 * Everything is deterministic: same skeleton + same pose = same joint positions.
 */

export interface Bone {
  readonly name: string;
  /** Parent bone name, or null for a root bone anchored at the skeleton origin. */
  readonly parent: string | null;
  /** Length of the bone in pixels. */
  readonly length: number;
  /** Rest angle in radians, relative to the parent's direction (absolute for roots). */
  readonly angle: number;
}

export type Skeleton = readonly Bone[];

/** Angle overrides keyed by bone name, in radians (relative to parent). */
export type Pose = Readonly<Record<string, number>>;

export interface SkeletonAnchor {
  readonly x: number;
  readonly y: number;
}

/** Resolved joint positions for every bone, keyed by bone name. */
export type JointPositions = Readonly<Record<string, Point>>;

/**
 * Compute joint positions for a skeleton under a pose. Each bone starts where
 * its parent ends and points along (parent direction + own/rest angle). Root
 * bones are anchored at `anchor` and use their absolute angle.
 */
export function poseSkeleton(
  skeleton: Skeleton,
  pose: Pose = {},
  anchor: SkeletonAnchor = { x: 0, y: 0 },
): JointPositions {
  const byName = new Map<string, Bone>();
  for (const bone of skeleton) byName.set(bone.name, bone);

  const resolvedStart = new Map<string, Point>();
  const resolvedAngle = new Map<string, number>();
  const joints: Record<string, Point> = {};

  const resolveBone = (bone: Bone): void => {
    if (resolvedStart.has(bone.name)) return;
    const angle = pose[bone.name] ?? bone.angle;
    let start: Point;
    let baseAngle: number;
    if (bone.parent === null) {
      start = anchor;
      baseAngle = angle;
    } else {
      const parent = byName.get(bone.parent);
      if (!parent) {
        start = anchor;
        baseAngle = angle;
      } else {
        resolveBone(parent);
        start = resolvedStart.get(bone.name) ?? anchor;
        baseAngle = (resolvedAngle.get(bone.parent) ?? 0) + angle;
      }
    }
    const end: Point = {
      x: start.x + Math.cos(baseAngle) * bone.length,
      y: start.y + Math.sin(baseAngle) * bone.length,
    };
    resolvedStart.set(bone.name, start);
    resolvedAngle.set(bone.name, baseAngle);
    joints[bone.name] = start;
    joints[`${bone.name}:end`] = end;
  };

  for (const bone of skeleton) resolveBone(bone);
  return joints;
}

export interface DrawSkeletonParams {
  readonly stroke?: Stroke;
  readonly anchor?: SkeletonAnchor;
  /** Draw a small dot at each joint. */
  readonly joints?: boolean;
  readonly jointRadius?: number;
  readonly jointColor?: string;
}

/**
 * Draw a skeleton onto a canvas context under a pose. Bones are drawn as
 * lines; joints optionally as dots. This is a pure drawing primitive — style
 * and motion are the caller's responsibility.
 */
export function drawSkeleton(
  canvas: Canvas,
  ctx: SKRSContext2D,
  skeleton: Skeleton,
  pose: Pose = {},
  params: DrawSkeletonParams = {},
): JointPositions {
  const joints = poseSkeleton(skeleton, pose, params.anchor);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (params.stroke) {
    ctx.strokeStyle = `rgba(${params.stroke.color.r}, ${params.stroke.color.g}, ${params.stroke.color.b}, ${params.stroke.color.a})`;
    ctx.lineWidth = params.stroke.width;
  } else {
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 2;
  }
  for (const bone of skeleton) {
    const start = joints[bone.name];
    const end = joints[`${bone.name}:end`];
    if (!start || !end) continue;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  if (params.joints) {
    const radius = params.jointRadius ?? 3;
    ctx.fillStyle = params.jointColor ?? "rgba(255,255,255,1)";
    for (const bone of skeleton) {
      const start = joints[bone.name];
      if (!start) continue;
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  void canvas;
  return joints;
}

/**
 * A minimal humanoid stick-figure skeleton, useful as a starting point for
 * code-authored characters. It is a primitive example, not shipped content —
 * authors are expected to define their own skeletons.
 */
export function humanoidSkeleton(scale = 1): Skeleton {
  return [
    { name: "hips", parent: null, length: 0, angle: -Math.PI / 2 },
    { name: "spine", parent: "hips", length: 40 * scale, angle: 0 },
    { name: "head", parent: "spine", length: 24 * scale, angle: 0 },
    { name: "upperArmL", parent: "spine", length: 28 * scale, angle: Math.PI * 0.75 },
    { name: "lowerArmL", parent: "upperArmL", length: 26 * scale, angle: Math.PI * 0.15 },
    { name: "upperArmR", parent: "spine", length: 28 * scale, angle: -Math.PI * 0.75 },
    { name: "lowerArmR", parent: "upperArmR", length: 26 * scale, angle: -Math.PI * 0.15 },
    { name: "upperLegL", parent: "hips", length: 34 * scale, angle: Math.PI * 0.55 },
    { name: "lowerLegL", parent: "upperLegL", length: 32 * scale, angle: -Math.PI * 0.1 },
    { name: "upperLegR", parent: "hips", length: 34 * scale, angle: -Math.PI * 0.55 },
    { name: "lowerLegR", parent: "upperLegR", length: 32 * scale, angle: Math.PI * 0.1 },
  ];
}
