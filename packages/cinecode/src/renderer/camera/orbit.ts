import { Camera, DEFAULT_PERSPECTIVE, rotateQuaternion, type CameraProjection, type Vec3 } from "./rig.js";

export interface OrbitCameraOptions {
  readonly target?: Vec3;
  readonly azimuthDegrees?: number;
  readonly elevationDegrees?: number;
  readonly distance?: number;
  readonly autoBank?: boolean;
  readonly bankStrength?: number;
  readonly projection?: CameraProjection;
  readonly aspect?: number;
}

export interface OrbitState {
  readonly target: Vec3;
  readonly azimuthDegrees: number;
  readonly elevationDegrees: number;
  readonly distance: number;
}

const MAX_ELEVATION = 89.5;

export class OrbitCamera extends Camera {
  private targetPoint: Vec3;
  private azimuth: number;
  private elevation: number;
  private radius: number;
  private banking: boolean;
  private readonly bankFactor: number;
  private angularVelocity = 0;

  constructor(options: OrbitCameraOptions = {}) {
    const target = options.target ?? [0, 0, 0];
    const azimuth = options.azimuthDegrees ?? 45;
    const elevation = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, options.elevationDegrees ?? 20));
    const distance = Math.max(0.0001, options.distance ?? 5);
    const position = OrbitCamera.positionFor(target, azimuth, elevation, distance);
    super({ projection: options.projection ?? DEFAULT_PERSPECTIVE, aspect: options.aspect, position, target });
    this.targetPoint = target;
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.radius = distance;
    this.banking = options.autoBank === true;
    this.bankFactor = options.bankStrength ?? 0.35;
    this.lookAt(target);
  }

  private static positionFor(target: Vec3, azimuthDegrees: number, elevationDegrees: number, distance: number): Vec3 {
    const azimuth = (azimuthDegrees * Math.PI) / 180;
    const elevation = (elevationDegrees * Math.PI) / 180;
    return [
      target[0] + distance * Math.cos(elevation) * Math.sin(azimuth),
      target[1] + distance * Math.sin(elevation),
      target[2] + distance * Math.cos(elevation) * Math.cos(azimuth),
    ];
  }

  getOrbitState(): OrbitState {
    return {
      target: this.targetPoint,
      azimuthDegrees: this.azimuth,
      elevationDegrees: this.elevation,
      distance: this.radius,
    };
  }

  setOrbit(state: Partial<OrbitState>): void {
    if (state.target) this.targetPoint = state.target;
    if (state.azimuthDegrees !== undefined) this.azimuth = state.azimuthDegrees;
    if (state.elevationDegrees !== undefined) {
      this.elevation = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, state.elevationDegrees));
    }
    if (state.distance !== undefined) this.radius = Math.max(0.0001, state.distance);
    this.positionValue = OrbitCamera.positionFor(this.targetPoint, this.azimuth, this.elevation, this.radius);
    this.lookAt(this.targetPoint);
    this.applyBank();
  }

  orbitBy(deltaAzimuthDegrees: number, deltaElevationDegrees: number = 0): void {
    this.angularVelocity = deltaAzimuthDegrees;
    this.setOrbit({
      azimuthDegrees: this.azimuth + deltaAzimuthDegrees,
      elevationDegrees: this.elevation + deltaElevationDegrees,
    });
  }

  dolly(delta: number): void {
    this.setOrbit({ distance: Math.max(0.0001, this.radius + delta) });
  }

  setAutoBank(enabled: boolean): void {
    this.banking = enabled;
    this.applyBank();
  }

  setAngularVelocity(degreesPerSecond: number): void {
    this.angularVelocity = degreesPerSecond;
    this.applyBank();
  }

  private applyBank(): void {
    if (!this.banking) return;
    const bank = Math.max(-30, Math.min(30, -this.angularVelocity * this.bankFactor));
    const orientation = this.orientation;
    this.setOrientation(rotateQuaternion(orientation, [0, 0, 1], bank));
  }

  trackTarget(resolver: (timeSeconds: number) => Vec3, timeSeconds: number): void {
    this.setOrbit({ target: resolver(timeSeconds) });
  }
}

export function createOrbitCamera(options: OrbitCameraOptions = {}): OrbitCamera {
  return new OrbitCamera(options);
}
