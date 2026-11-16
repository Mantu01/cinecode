import type { ParticleClip } from "../core/types/clips.js";
import type { Rgba } from "../renderer/color/types.js";
import { parseColor } from "../renderer/color/parse.js";

export interface ParticleVector {
  readonly x: number;
  readonly y: number;
}

export interface ParticleBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax?: number;
  ay?: number;
  mass?: number;
  age: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GravityForceConfig {
  readonly type: "gravity";
  readonly x?: number;
  readonly y?: number;
}

export interface WindForceConfig {
  readonly type: "wind";
  readonly directionDegrees?: number;
  readonly speed?: number;
  readonly turbulence?: number;
}

export interface AttractionForceConfig {
  readonly type: "attraction";
  readonly x?: number;
  readonly y?: number;
  readonly strength?: number;
}

export interface VortexForceConfig {
  readonly type: "vortex";
  readonly x?: number;
  readonly y?: number;
  readonly strength?: number;
}

export interface TurbulenceForceConfig {
  readonly type: "turbulence";
  readonly strength?: number;
  readonly scale?: number;
}

export interface DragForceConfig {
  readonly type: "drag";
}

export type ParticleForce =
  | GravityForceConfig
  | WindForceConfig
  | AttractionForceConfig
  | VortexForceConfig
  | TurbulenceForceConfig
  | DragForceConfig;

export interface BoxColliderConfig {
  readonly type: "box";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CircleColliderConfig {
  readonly type: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface LineColliderConfig {
  readonly type: "line";
  readonly x: number;
  readonly y: number;
  readonly normal: ParticleVector;
}

export interface PolygonColliderConfig {
  readonly type: "polygon";
  readonly points: readonly ParticleVector[];
}

export type ParticleCollider =
  | BoxColliderConfig
  | CircleColliderConfig
  | LineColliderConfig
  | PolygonColliderConfig;

export interface ParticleWindConfig {
  readonly directionDegrees?: number;
  readonly speed?: number;
  readonly turbulence?: number;
}

export interface ParticlePhysicsConfig {
  readonly gravity?: number | ParticleVector;
  readonly wind?: ParticleWindConfig;
  readonly drag?: number;
  readonly forces?: readonly ParticleForce[];
  readonly colliders?: readonly ParticleCollider[];
  readonly particleCollision?: boolean;
  readonly timeStep?: number;
  readonly maxSpeed?: number;
  readonly restitution?: number;
  readonly friction?: number;
  /** Viewport AABB for boundary bouncing (defaults to no bounds). */
  readonly bounds?: ParticleBounds;
}

export interface EmitterConfig {
  readonly emitRate: number;
  readonly lifetime: number;
  readonly velocity: number;
  readonly gravity: number;
  readonly physics: ParticlePhysicsConfig | null;
  readonly sizeStart: number;
  readonly sizeEnd: number;
  readonly colorStart: Rgba;
  readonly colorEnd: Rgba;
  readonly blending: "additive" | "normal";
  readonly emitterShape: "point" | "circle" | "rectangle";
  readonly emitterRadius: number;
  readonly emitterWidth: number;
  readonly emitterHeight: number;
  readonly seed: number;
}

export interface ParticleState {
  readonly particles: readonly Particle[];
  readonly count: number;
}

export const MAX_PARTICLES = 1000;

export function resolveEmitterConfig(
  params: ParticleClip["params"] & { readonly physics?: ParticlePhysicsConfig },
  seed: number | undefined,
): EmitterConfig {
  return {
    emitRate: Math.max(0, params.emitRate),
    lifetime: Math.max(0.001, params.lifetime),
    velocity: params.velocity ?? 0,
    gravity: params.gravity ?? 0,
    physics: params.physics ?? null,
    sizeStart: params.sizeStart,
    sizeEnd: params.sizeEnd ?? params.sizeStart,
    colorStart: parseSafeColor(params.colorStart, 0xff0000),
    colorEnd: params.colorEnd === undefined ? parseSafeColor(params.colorStart, 0xff0000) : parseSafeColor(params.colorEnd, 0xff0000),
    blending: params.blending ?? "normal",
    emitterShape: params.emitterShape ?? "point",
    emitterRadius: params.emitterRadius ?? 0,
    emitterWidth: params.emitterWidth ?? 0,
    emitterHeight: params.emitterHeight ?? 0,
    seed: seed ?? 0,
  };
}

function parseSafeColor(value: string, fallbackHex: number): Rgba {
  try {
    return parseColor(value);
  } catch {
    return { r: (fallbackHex >> 16) & 0xff, g: (fallbackHex >> 8) & 0xff, b: fallbackHex & 0xff, a: 1 };
  }
}
