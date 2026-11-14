import { Camera, DEFAULT_PERSPECTIVE, type CameraProjection, type Vec3 } from "./rig.js";

export interface FollowCameraOptions {
  readonly target?: Vec3;
  readonly offset?: Vec3;
  readonly lookaheadSeconds?: number;
  readonly damping?: number;
  readonly projection?: CameraProjection;
  readonly aspect?: number;
  readonly planeDepth?: number;
}

export type FollowTargetResolver = (timeSeconds: number) => Vec3;

export interface FollowCameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly lookaheadSeconds: number;
  readonly damping: number;
}

export interface FollowTarget2D {
  readonly x: number;
  readonly y: number;
  readonly depth?: number;
}

export function targetFrom2d(target: FollowTarget2D, planeDepth = 0): Vec3 {
  return [target.x, target.y, target.depth ?? planeDepth];
}

export class FollowCamera extends Camera {
  private readonly offsetVector: Vec3;
  private lookahead: number;
  private dampingFactor: number;
  private velocity: Vec3 = [0, 0, 0];
  private readonly planeDepth: number;

  constructor(options: FollowCameraOptions = {}) {
    const target = options.target ?? [0, 0, 0];
    const offset = options.offset ?? [0, 0, 5];
    const position: Vec3 = [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]];
    super({ projection: options.projection ?? DEFAULT_PERSPECTIVE, aspect: options.aspect, position, target });
    this.offsetVector = offset;
    this.lookahead = Math.max(0, options.lookaheadSeconds ?? 0.25);
    this.dampingFactor = Math.max(0, Math.min(1, options.damping ?? 0.15));
    this.planeDepth = options.planeDepth ?? 0;
    this.lookAt(target);
  }

  getFollowState(): FollowCameraState {
    return {
      position: this.position,
      target: this.target,
      lookaheadSeconds: this.lookahead,
      damping: this.dampingFactor,
    };
  }

  setFollowParams(params: { readonly lookaheadSeconds?: number; readonly damping?: number }): void {
    if (params.lookaheadSeconds !== undefined) this.lookahead = Math.max(0, params.lookaheadSeconds);
    if (params.damping !== undefined) this.dampingFactor = Math.max(0, Math.min(1, params.damping));
  }

  snapTo(target: Vec3): void {
    const desired: Vec3 = [
      target[0] + this.offsetVector[0],
      target[1] + this.offsetVector[1],
      target[2] + this.offsetVector[2],
    ];
    this.setPosition(desired);
    this.setTarget(target);
    this.lookAt(target);
    this.velocity = [0, 0, 0];
  }

  follow(target: Vec3, deltaSeconds: number): void {
    const dt = Math.max(0, deltaSeconds);
    const lookaheadTarget: Vec3 = [
      target[0] + this.velocity[0] * this.lookahead,
      target[1] + this.velocity[1] * this.lookahead,
      target[2] + this.velocity[2] * this.lookahead,
    ];
    const desired: Vec3 = [
      lookaheadTarget[0] + this.offsetVector[0],
      lookaheadTarget[1] + this.offsetVector[1],
      lookaheadTarget[2] + this.offsetVector[2],
    ];
    const blend = this.smoothingFactor(dt);
    const currentPosition = this.position;
    const nextPosition: Vec3 = [
      currentPosition[0] + (desired[0] - currentPosition[0]) * blend,
      currentPosition[1] + (desired[1] - currentPosition[1]) * blend,
      currentPosition[2] + (desired[2] - currentPosition[2]) * blend,
    ];
    const currentTarget = this.target;
    const nextTarget: Vec3 = [
      currentTarget[0] + (lookaheadTarget[0] - currentTarget[0]) * blend,
      currentTarget[1] + (lookaheadTarget[1] - currentTarget[1]) * blend,
      currentTarget[2] + (lookaheadTarget[2] - currentTarget[2]) * blend,
    ];
    if (dt > 0) {
      this.velocity = [
        (nextTarget[0] - currentTarget[0]) / dt,
        (nextTarget[1] - currentTarget[1]) / dt,
        (nextTarget[2] - currentTarget[2]) / dt,
      ];
    }
    this.setPosition(nextPosition);
    this.setTarget(nextTarget);
    this.lookAt(nextTarget);
  }

  follow2d(target: FollowTarget2D, deltaSeconds: number): void {
    this.follow(targetFrom2d(target, this.planeDepth), deltaSeconds);
  }

  trackResolver(resolver: FollowTargetResolver, timeSeconds: number, deltaSeconds: number): void {
    this.follow(resolver(timeSeconds), deltaSeconds);
  }

  private smoothingFactor(deltaSeconds: number): number {
    if (deltaSeconds <= 0) return 1;
    const rate = this.dampingFactor <= 0 ? 1 : 1 - Math.exp(-deltaSeconds / this.dampingFactor);
    return Math.max(0, Math.min(1, rate));
  }
}

export function createFollowCamera(options: FollowCameraOptions = {}): FollowCamera {
  return new FollowCamera(options);
}
