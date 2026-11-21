import { mat4, quat, vec3 } from "./math.js";

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type ProjectionKind = "perspective" | "orthographic";

export interface PerspectiveProjection {
  readonly kind: "perspective";
  readonly fovDegrees: number;
  readonly near: number;
  readonly far: number;
  readonly focalLengthMm?: number;
  readonly sensorHeightMm?: number;
}

export interface OrthographicProjection {
  readonly kind: "orthographic";
  readonly zoom: number;
  readonly near: number;
  readonly far: number;
  readonly aspect?: number;
}

export type CameraProjection = PerspectiveProjection | OrthographicProjection;

export interface CameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly orientation: Quat;
  readonly projection: CameraProjection;
  readonly aspect: number;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly orientation: Quat;
}

export const DEFAULT_PERSPECTIVE: PerspectiveProjection = {
  kind: "perspective",
  fovDegrees: 50,
  near: 0.1,
  far: 1000,
};

export const DEFAULT_ORTHOGRAPHIC: OrthographicProjection = {
  kind: "orthographic",
  zoom: 1,
  near: 0.1,
  far: 1000,
};

export function focalLengthToFov(focalLengthMm: number, sensorHeightMm = 24): number {
  if (focalLengthMm <= 0 || sensorHeightMm <= 0) return DEFAULT_PERSPECTIVE.fovDegrees;
  return (2 * Math.atan(sensorHeightMm / (2 * focalLengthMm)) * 180) / Math.PI;
}

export function fovToFocalLength(fovDegrees: number, sensorHeightMm = 24): number {
  const radians = (Math.max(1, Math.min(179, fovDegrees)) * Math.PI) / 180;
  return sensorHeightMm / (2 * Math.tan(radians / 2));
}

export function quaternionFromEuler(pitchDegrees: number, yawDegrees: number, rollDegrees: number): Quat {
  const pitch = (pitchDegrees * Math.PI) / 180;
  const yaw = (yawDegrees * Math.PI) / 180;
  const roll = (rollDegrees * Math.PI) / 180;
  const result = quat.fromEuler(pitch, yaw, roll, "xyz");
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1];
}

export function quaternionFromAxisAngle(axis: Vec3, degrees: number): Quat {
  const normalized = vec3.normalize(axis);
  const result = quat.fromAxisAngle(normalized, (degrees * Math.PI) / 180);
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1];
}

export function quaternionToEuler(orientation: Quat): { readonly pitch: number; readonly yaw: number; readonly roll: number } {
  const [x = 0, y = 0, z = 0, w = 1] = orientation;
  const sinPitch = 2 * (w * y - z * x);
  const pitch = Math.abs(sinPitch) >= 1 ? Math.sign(sinPitch) * (Math.PI / 2) : Math.asin(sinPitch);
  const yaw = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { pitch: (pitch * 180) / Math.PI, yaw: (yaw * 180) / Math.PI, roll: (roll * 180) / Math.PI };
}

export function slerpQuaternion(from: Quat, to: Quat, t: number): Quat {
  const result = quat.slerp(
    quat.fromValues(from[0], from[1], from[2], from[3]),
    quat.fromValues(to[0], to[1], to[2], to[3]),
    Math.max(0, Math.min(1, t)),
  );
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1];
}

export function rotateQuaternion(orientation: Quat, axis: Vec3, degrees: number): Quat {
  const delta = quaternionFromAxisAngle(axis, degrees);
  const result = quat.multiply(
    quat.fromValues(orientation[0], orientation[1], orientation[2], orientation[3]),
    quat.fromValues(delta[0], delta[1], delta[2], delta[3]),
  );
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1];
}

export function forwardVector(orientation: Quat): Vec3 {
  const x = orientation[0] ?? 0;
  const y = orientation[1] ?? 0;
  const z = orientation[2] ?? 0;
  const w = orientation[3] ?? 1;
  return [
    -2 * (x * z + w * y),
    -2 * (y * z - w * x),
    -(1 - 2 * (x * x + y * y)),
  ];
}

export function lookAtQuaternion(position: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const direction = vec3.normalize(vec3.subtract(target, position));
  const right = vec3.normalize(vec3.cross(up, direction));
  const correctedUp = vec3.cross(direction, right);
  const rotation = mat4.identity();
  const withBasis = mat4.set(
    Number(right[0]), Number(correctedUp[0]), -Number(direction[0]), 0,
    Number(right[1]), Number(correctedUp[1]), -Number(direction[1]), 0,
    Number(right[2]), Number(correctedUp[2]), -Number(direction[2]), 0,
    0, 0, 0, 1,
    rotation,
  );
  const result = quat.fromMat(withBasis);
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 1];
}

export class Camera {
  protected projection: CameraProjection;
  protected aspect: number;
  protected positionValue: Vec3;
  protected targetValue: Vec3;
  protected upValue: Vec3 = [0, 1, 0];
  protected orientationValue: Quat = [0, 0, 0, 1];

  constructor(options: { projection?: CameraProjection; aspect?: number; position?: Vec3; target?: Vec3 } = {}) {
    this.projection = options.projection ?? DEFAULT_PERSPECTIVE;
    this.aspect = options.aspect ?? 16 / 9;
    this.positionValue = options.position ?? [0, 0, 5];
    this.targetValue = options.target ?? [0, 0, 0];
    this.orientationValue = lookAtQuaternion(this.positionValue, this.targetValue, this.upValue);
  }

  get position(): Vec3 {
    return this.positionValue;
  }

  get target(): Vec3 {
    return this.targetValue;
  }

  get orientation(): Quat {
    return this.orientationValue;
  }

  get cameraProjection(): CameraProjection {
    return this.projection;
  }

  setProjection(projection: CameraProjection): void {
    this.projection = projection;
  }

  setAspect(aspect: number): void {
    this.aspect = Math.max(0.0001, aspect);
  }

  setPosition(position: Vec3): void {
    this.positionValue = position;
  }

  setTarget(target: Vec3): void {
    this.targetValue = target;
  }

  setOrientation(orientation: Quat): void {
    this.orientationValue = orientation;
  }

  lookAt(target: Vec3, up?: Vec3): void {
    this.targetValue = target;
    if (up) this.upValue = up;
    this.orientationValue = lookAtQuaternion(this.positionValue, target, this.upValue);
  }

  orbit(deltaYawDegrees: number, deltaPitchDegrees: number): void {
    const offset = vec3.subtract(this.positionValue, this.targetValue);
    const radius = vec3.length(offset);
    const current = quaternionToEuler(this.orientationValue);
    const yaw = ((current.yaw + deltaYawDegrees) * Math.PI) / 180;
    const pitch = Math.max((-89.9 * Math.PI) / 180, Math.min((89.9 * Math.PI) / 180, ((current.pitch + deltaPitchDegrees) * Math.PI) / 180));
    const x = radius * Math.cos(pitch) * Math.sin(yaw);
    const y = radius * Math.sin(pitch);
    const z = radius * Math.cos(pitch) * Math.cos(yaw);
    this.positionValue = [this.targetValue[0] + x, this.targetValue[1] + y, this.targetValue[2] + z];
    this.orientationValue = lookAtQuaternion(this.positionValue, this.targetValue, this.upValue);
  }

  getViewMatrix(): Float32Array {
    return mat4.lookAt(
      vec3.fromValues(this.positionValue[0], this.positionValue[1], this.positionValue[2]),
      vec3.fromValues(this.targetValue[0], this.targetValue[1], this.targetValue[2]),
      vec3.fromValues(this.upValue[0], this.upValue[1], this.upValue[2]),
      mat4.identity(),
    ) as Float32Array;
  }

  getProjectionMatrix(): Float32Array {
    if (this.projection.kind === "orthographic") {
      const halfHeight = 1 / Math.max(0.0001, this.projection.zoom);
      const halfWidth = halfHeight * (this.projection.aspect ?? this.aspect);
      return mat4.ortho(
        -halfWidth,
        halfWidth,
        -halfHeight,
        halfHeight,
        this.projection.near,
        this.projection.far,
        mat4.identity(),
      ) as Float32Array;
    }
    const fov = this.projection.focalLengthMm !== undefined
      ? focalLengthToFov(this.projection.focalLengthMm, this.projection.sensorHeightMm)
      : this.projection.fovDegrees;
    return mat4.perspective(
      (Math.max(1, Math.min(179, fov)) * Math.PI) / 180,
      this.aspect,
      this.projection.near,
      this.projection.far,
      mat4.identity(),
    ) as Float32Array;
  }

  getViewProjectionMatrix(): Float32Array {
    return mat4.multiply(this.getProjectionMatrix(), this.getViewMatrix(), mat4.identity()) as Float32Array;
  }

  getState(): CameraState {
    return {
      position: this.positionValue,
      target: this.targetValue,
      up: this.upValue,
      orientation: this.orientationValue,
      projection: this.projection,
      aspect: this.aspect,
    };
  }

  applyState(state: Partial<CameraState>): void {
    if (state.position) this.positionValue = state.position;
    if (state.target) this.targetValue = state.target;
    if (state.up) this.upValue = state.up;
    if (state.orientation) {
      this.orientationValue = state.orientation;
    } else if (state.position || state.target) {
      this.orientationValue = lookAtQuaternion(this.positionValue, this.targetValue, this.upValue);
    }
    if (state.projection) this.projection = state.projection;
    if (state.aspect !== undefined) this.aspect = state.aspect;
  }

  interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
    const clamped = Math.max(0, Math.min(1, t));
    return {
      position: [
        from.position[0] + (to.position[0] - from.position[0]) * clamped,
        from.position[1] + (to.position[1] - from.position[1]) * clamped,
        from.position[2] + (to.position[2] - from.position[2]) * clamped,
      ],
      target: [
        from.target[0] + (to.target[0] - from.target[0]) * clamped,
        from.target[1] + (to.target[1] - from.target[1]) * clamped,
        from.target[2] + (to.target[2] - from.target[2]) * clamped,
      ],
      orientation: slerpQuaternion(from.orientation, to.orientation, clamped),
    };
  }
}

export function createCamera(options?: { projection?: CameraProjection; aspect?: number; position?: Vec3; target?: Vec3 }): Camera {
  return new Camera(options);
}
