import { mat4, vec3 } from "../../renderer/camera/math.js";
import type { Camera, CameraPose, Quat, Vec3 } from "../../renderer/camera/rig.js";
import { slerpQuaternion } from "../../renderer/camera/rig.js";
import type { CameraSwitchEvent, CameraTransitionType, MultiCameraClip } from "../types/clips.js";
import { createError, ErrorCode } from "../../errors/index.js";

export const DEFAULT_CAMERA_TRANSITION_SECONDS = 0.5;

export interface CameraViewState {
  readonly cameraId: string;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly orientation: Quat;
  readonly viewMatrix: Float32Array;
  readonly projectionMatrix: Float32Array;
}

export interface MultiCameraFrameState {
  readonly timeSeconds: number;
  readonly activeCameraId: string;
  readonly transitionType: CameraTransitionType;
  readonly transitionProgress: number;
  readonly from: CameraViewState | null;
  readonly to: CameraViewState;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly orientation: Quat;
  readonly viewMatrix: Float32Array;
  readonly projectionMatrix: Float32Array;
}

export function normalizeCameraSwitches(
  switches: readonly CameraSwitchEvent[],
): CameraSwitchEvent[] {
  return switches
    .map((event) => ({
      ...event,
      timestampSeconds: Math.max(0, Number.isFinite(event.timestampSeconds) ? event.timestampSeconds : 0),
      transitionDurationSeconds:
        event.transitionType === "cut"
          ? 0
          : Math.max(
              0,
              event.transitionDurationSeconds === undefined || !Number.isFinite(event.transitionDurationSeconds)
                ? DEFAULT_CAMERA_TRANSITION_SECONDS
                : event.transitionDurationSeconds,
            ),
    }))
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

export function defaultCameraIdFor(clip: Pick<MultiCameraClip, "cameras" | "defaultCameraId" | "switches">): string {
  if (clip.defaultCameraId && clip.cameras[clip.defaultCameraId]) return clip.defaultCameraId;
  const fromSwitch = clip.switches?.find((event) => clip.cameras[event.targetCameraId]);
  if (fromSwitch) return fromSwitch.targetCameraId;
  return Object.keys(clip.cameras)[0] ?? "";
}

function interpolatePose(from: CameraPose, to: CameraPose, progress: number): CameraPose {
  const t = Math.max(0, Math.min(1, progress));
  return {
    position: [
      from.position[0] + (to.position[0] - from.position[0]) * t,
      from.position[1] + (to.position[1] - from.position[1]) * t,
      from.position[2] + (to.position[2] - from.position[2]) * t,
    ],
    target: [
      from.target[0] + (to.target[0] - from.target[0]) * t,
      from.target[1] + (to.target[1] - from.target[1]) * t,
      from.target[2] + (to.target[2] - from.target[2]) * t,
    ],
    orientation: slerpQuaternion(from.orientation, to.orientation, t),
  };
}

export function interpolateCameraPoses(from: CameraPose, to: CameraPose, progress: number): CameraPose {
  return interpolatePose(from, to, progress);
}

export function cameraViewFromPose(pose: CameraPose, projectionMatrix: Float32Array, cameraId: string): CameraViewState {
  const viewMatrix = mat4.lookAt(
    vec3.fromValues(pose.position[0], pose.position[1], pose.position[2]),
    vec3.fromValues(pose.target[0], pose.target[1], pose.target[2]),
    vec3.fromValues(0, 1, 0),
    mat4.identity(),
  ) as Float32Array;
  return {
    cameraId,
    position: pose.position,
    target: pose.target,
    orientation: pose.orientation,
    viewMatrix,
    projectionMatrix,
  };
}

function resolveCamera(clip: Pick<MultiCameraClip, "cameras">, cameraId: string): Camera | null {
  return clip.cameras[cameraId] ?? null;
}

function viewStateFor(cameraId: string, camera: Camera, aspect: number): CameraViewState {
  const state = camera.getState();
  if (Math.abs(state.aspect - aspect) > 1e-6) camera.setAspect(aspect);
  return {
    cameraId,
    position: state.position,
    target: state.target,
    orientation: state.orientation,
    viewMatrix: camera.getViewMatrix(),
    projectionMatrix: camera.getProjectionMatrix(),
  };
}

export interface MultiCameraEvaluationOptions {
  readonly aspect?: number;
}

export function evaluateMultiCamera(
  clip: Pick<MultiCameraClip, "cameras" | "switches" | "defaultCameraId">,
  timeSeconds: number,
  options: MultiCameraEvaluationOptions = {},
): MultiCameraFrameState {
  const aspect = options.aspect ?? 16 / 9;
  const fallbackId = defaultCameraIdFor(clip);
  const fallbackCamera = resolveCamera(clip, fallbackId);
  if (!fallbackCamera) {
    throw createError(ErrorCode.CC2101, { camera: fallbackId });
  }

  const events = normalizeCameraSwitches(clip.switches ?? []);
  const time = Math.max(0, timeSeconds);
  let currentId = fallbackId;
  let transitionFromId: string | null = null;
  let transitionType: CameraTransitionType = "cut";
  let transitionStart = 0;
  let transitionDuration = 0;

  for (const event of events) {
    if (time < event.timestampSeconds) break;
    const targetCamera = resolveCamera(clip, event.targetCameraId);
    if (!targetCamera) continue;
    const fromId = currentId;
    const duration = event.transitionType === "cut" ? 0 : (event.transitionDurationSeconds ?? DEFAULT_CAMERA_TRANSITION_SECONDS);
    if (duration > 0 && targetCamera && event.targetCameraId !== fromId && time < event.timestampSeconds + duration) {
      transitionFromId = fromId;
      transitionType = event.transitionType;
      transitionStart = event.timestampSeconds;
      transitionDuration = duration;
    } else {
      transitionFromId = null;
    }
    currentId = event.targetCameraId;
  }

  const targetCamera = resolveCamera(clip, currentId) ?? fallbackCamera;
  const to = viewStateFor(currentId, targetCamera, aspect);

  let from: CameraViewState | null = null;
  let progress = 1;
  if (transitionFromId !== null) {
    const sourceCamera = resolveCamera(clip, transitionFromId);
    if (sourceCamera) {
      from = viewStateFor(transitionFromId, sourceCamera, aspect);
      progress = Math.max(0, Math.min(1, (time - transitionStart) / transitionDuration));
    }
  }

  const effectiveType: CameraTransitionType = from ? transitionType : "cut";
  const pose: CameraPose = from
    ? interpolatePose(
        { position: from.position, target: from.target, orientation: from.orientation },
        { position: to.position, target: to.target, orientation: to.orientation },
        progress,
      )
    : { position: to.position, target: to.target, orientation: to.orientation };
  const blended = cameraViewFromPose(pose, to.projectionMatrix, to.cameraId);

  return {
    timeSeconds: time,
    activeCameraId: currentId,
    transitionType: effectiveType,
    transitionProgress: effectiveType === "cut" ? 1 : progress,
    from,
    to,
    position: blended.position,
    target: blended.target,
    orientation: blended.orientation,
    viewMatrix: blended.viewMatrix,
    projectionMatrix: blended.projectionMatrix,
  };
}

export function activeCameraAt(
  clip: Pick<MultiCameraClip, "cameras" | "switches" | "defaultCameraId">,
  timeSeconds: number,
): string {
  return evaluateMultiCamera(clip, timeSeconds).activeCameraId;
}

export function multiCamera(
  src: string,
  cameras: Record<string, Camera>,
  options: Omit<MultiCameraClip, "type" | "src" | "cameras"> = {},
): MultiCameraClip {
  return { type: "multiCamera", src, cameras, ...options };
}
