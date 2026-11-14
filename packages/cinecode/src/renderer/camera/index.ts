import { Camera, slerpQuaternion, type CameraPose, type CameraProjection, type Quat, type Vec3 } from "./rig.js";
import { createOrbitCamera, OrbitCamera, type OrbitCameraOptions } from "./orbit.js";
import { createFollowCamera, FollowCamera, type FollowCameraOptions } from "./follow.js";

export * from "./rig.js";
export * from "./orbit.js";
export * from "./follow.js";

export type CameraRigKind = "static" | "orbit" | "follow";

export interface CameraKeyframe {
  readonly timeSeconds: number;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly orientation?: Quat;
}

export interface CameraTrack {
  readonly keyframes: readonly CameraKeyframe[];
}

export type CameraRigOptions = {
  readonly static?: { readonly projection?: CameraProjection; readonly aspect?: number; readonly position?: Vec3; readonly target?: Vec3 };
  readonly orbit?: OrbitCameraOptions;
  readonly follow?: FollowCameraOptions;
};

export function evaluateCameraTrack(track: CameraTrack, timeSeconds: number): CameraPose | null {
  const frames = [...track.keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  if (frames.length === 0) return null;
  const first = frames[0];
  if (!first) return null;
  if (frames.length === 1 || timeSeconds <= first.timeSeconds) {
    return { position: first.position, target: first.target, orientation: first.orientation ?? [0, 0, 0, 1] };
  }
  const last = frames[frames.length - 1];
  if (!last) return null;
  if (timeSeconds >= last.timeSeconds) {
    return { position: last.position, target: last.target, orientation: last.orientation ?? [0, 0, 0, 1] };
  }
  let previous = first;
  let next = last;
  for (let index = 1; index < frames.length; index += 1) {
    const candidate = frames[index];
    if (!candidate) continue;
    if (candidate.timeSeconds >= timeSeconds) {
      previous = frames[index - 1] ?? first;
      next = candidate;
      break;
    }
  }
  const span = next.timeSeconds - previous.timeSeconds;
  const t = span <= 0 ? 0 : (timeSeconds - previous.timeSeconds) / span;
  const position: Vec3 = [
    previous.position[0] + (next.position[0] - previous.position[0]) * t,
    previous.position[1] + (next.position[1] - previous.position[1]) * t,
    previous.position[2] + (next.position[2] - previous.position[2]) * t,
  ];
  const target: Vec3 = [
    previous.target[0] + (next.target[0] - previous.target[0]) * t,
    previous.target[1] + (next.target[1] - previous.target[1]) * t,
    previous.target[2] + (next.target[2] - previous.target[2]) * t,
  ];
  const fromOrientation = previous.orientation ?? [0, 0, 0, 1];
  const toOrientation = next.orientation ?? fromOrientation;
  return { position, target, orientation: slerpQuaternion(fromOrientation, toOrientation, t) };
}

export function applyCameraPose(camera: Camera, pose: CameraPose): void {
  camera.applyState({ position: pose.position, target: pose.target, orientation: pose.orientation });
}

export function createCameraRig(kind: CameraRigKind, options: CameraRigOptions = {}): Camera {
  if (kind === "orbit") return createOrbitCamera(options.orbit ?? {});
  if (kind === "follow") return createFollowCamera(options.follow ?? {});
  return new Camera(options.static ?? {});
}

export class CameraRigRegistry {
  private readonly factories = new Map<CameraRigKind, (options: CameraRigOptions) => Camera>();

  constructor() {
    this.register("static", (options) => new Camera(options.static ?? {}));
    this.register("orbit", (options) => new OrbitCamera(options.orbit ?? {}));
    this.register("follow", (options) => new FollowCamera(options.follow ?? {}));
  }

  register(kind: CameraRigKind, factory: (options: CameraRigOptions) => Camera): void {
    this.factories.set(kind, factory);
  }

  has(kind: CameraRigKind): boolean {
    return this.factories.has(kind);
  }

  create(kind: CameraRigKind, options: CameraRigOptions = {}): Camera {
    const factory = this.factories.get(kind);
    if (!factory) throw new Error(`Unknown camera rig kind: ${kind}`);
    return factory(options);
  }

  kinds(): CameraRigKind[] {
    return [...this.factories.keys()];
  }
}

export const cameraRigRegistry = new CameraRigRegistry();
