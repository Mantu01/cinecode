import type {
  AnimationChannel,
  AnimationClip,
  Bone,
  Mat4,
  Quat,
  SkeletonState,
  Vec3,
} from "./types.js";

export function identityMat4(): Mat4 {
  return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4FromTrs(translation: Vec3, rotation: Quat, scale: Vec3): Mat4 {
  const [x, y, z, w] = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const sx = scale[0];
  const sy = scale[1];
  const sz = scale[2];
  const m = new Float32Array(16);
  m[0] = (1 - 2 * (yy + zz)) * sx;
  m[1] = 2 * (xy + wz) * sx;
  m[2] = 2 * (xz - wy) * sx;
  m[4] = 2 * (xy - wz) * sy;
  m[5] = (1 - 2 * (xx + zz)) * sy;
  m[6] = 2 * (yz + wx) * sy;
  m[8] = 2 * (xz + wy) * sz;
  m[9] = 2 * (yz - wx) * sz;
  m[10] = (1 - 2 * (xx + yy)) * sz;
  m[12] = translation[0];
  m[13] = translation[1];
  m[14] = translation[2];
  m[15] = 1;
  return m;
}

export function mat4FromQuat(rotation: Quat): Mat4 {
  return mat4FromTrs([0, 0, 0], rotation, [1, 1, 1]);
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatNormalize(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length === 0) return [0, 0, 0, 1];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cosine = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosine < 0) {
    cosine = -cosine;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cosine > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(cosine);
  const sinTheta = Math.sin(theta);
  const scaleA = Math.sin((1 - t) * theta) / sinTheta;
  const scaleB = Math.sin(t * theta) / sinTheta;
  return quatNormalize([
    a[0] * scaleA + bx * scaleB,
    a[1] * scaleA + by * scaleB,
    a[2] * scaleA + bz * scaleB,
    a[3] * scaleA + bw * scaleB,
  ]);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function findKeyframe(times: Float32Array, time: number): number {
  if (time <= times[0]!) return 0;
  if (time >= times[times.length - 1]!) return times.length - 1;
  let low = 0;
  let high = times.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (times[mid]! <= time) low = mid;
    else high = mid;
  }
  return low;
}

function componentsFor(type: AnimationChannel["targetType"]): number {
  return type === "rotation" ? 4 : 3;
}

export function sampleChannel(channel: AnimationChannel, time: number): number[] {
  const times = channel.inputTimes;
  const values = channel.outputValues;
  const components = componentsFor(channel.targetType);
  const key = findKeyframe(times, time);
  const keyCount = times.length;

  if (channel.interpolation === "CUBICSPLINE") {
    const stride = components * 3;
    const nextKey = Math.min(key + 1, keyCount - 1);
    const t0 = times[key]!;
    const t1 = times[nextKey]!;
    const span = t1 - t0 || 1;
    const s = Math.max(0, Math.min(1, (time - t0) / span));
    const base = key * stride;
    const nextBase = nextKey * stride;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const result: number[] = [];
    for (let c = 0; c < components; c += 1) {
      const p0 = values[base + components + c] ?? 0;
      const outTangent = (values[base + components * 2 + c] ?? 0) * span;
      const p1 = values[nextBase + components + c] ?? p0;
      const inTangent = (values[nextBase + c] ?? 0) * span;
      result.push(h00 * p0 + h10 * outTangent + h01 * p1 + h11 * inTangent);
    }
    return result;
  }

  const nextKey = Math.min(key + 1, keyCount - 1);
  const current: number[] = [];
  const next: number[] = [];
  for (let c = 0; c < components; c += 1) {
    current.push(values[key * components + c] ?? 0);
    next.push(values[nextKey * components + c] ?? 0);
  }

  if (channel.interpolation === "STEP" || key === nextKey) return current;
  const t0 = times[key]!;
  const t1 = times[nextKey]!;
  const span = t1 - t0;
  const factor = span <= 0 ? 0 : Math.max(0, Math.min(1, (time - t0) / span));

  if (channel.targetType === "rotation") {
    return [...quatSlerp(
      [current[0]!, current[1]!, current[2]!, current[3]!],
      [next[0]!, next[1]!, next[2]!, next[3]!],
      factor,
    )];
  }
  return current.map((value, index) => value + (next[index]! - value) * factor);
}

export interface AnimationPlayback {
  readonly clip?: AnimationClip;
  readonly time: number;
  readonly speed?: number;
  readonly loop?: boolean;
}

function resolveClipTime(playback: AnimationPlayback): number {
  const clip = playback.clip;
  if (!clip || clip.duration <= 0) return 0;
  const speed = playback.speed ?? 1;
  const raw = playback.time * speed;
  if (playback.loop === false) return Math.max(0, Math.min(clip.duration, raw));
  return ((raw % clip.duration) + clip.duration) % clip.duration;
}

function channelFor(
  clip: AnimationClip | undefined,
  boneIndex: number,
  type: AnimationChannel["targetType"],
): AnimationChannel | undefined {
  return clip?.channels.find((channel) => channel.targetBoneIndex === boneIndex && channel.targetType === type);
}

function localMatrix(bone: Bone, clip: AnimationClip | undefined, time: number): Mat4 {
  const translationChannel = channelFor(clip, bone.index, "translation");
  const rotationChannel = channelFor(clip, bone.index, "rotation");
  const scaleChannel = channelFor(clip, bone.index, "scale");

  const translation = translationChannel
    ? (sampleChannel(translationChannel, time) as unknown as Vec3)
    : bone.baseTranslation;
  const rotation = rotationChannel
    ? quatNormalize(sampleChannel(rotationChannel, time) as unknown as Quat)
    : bone.baseRotation;
  const scale = scaleChannel
    ? (sampleChannel(scaleChannel, time) as unknown as Vec3)
    : bone.baseScale;
  return mat4FromTrs(translation, rotation, scale);
}

export function computeBoneWorldMatrices(
  skeleton: SkeletonState,
  playback: AnimationPlayback,
): Map<number, Mat4> {
  const time = resolveClipTime(playback);
  const world = new Map<number, Mat4>();

  const compute = (bone: Bone): Mat4 => {
    const cached = world.get(bone.index);
    if (cached) return cached;
    const local = localMatrix(bone, playback.clip, time);
    const parent = bone.parentIndex !== undefined ? skeleton.boneByNode.get(bone.parentIndex) : undefined;
    const result = parent ? multiplyMat4(compute(parent), local) : local;
    world.set(bone.index, result);
    return result;
  };

  for (const bone of skeleton.bones) compute(bone);
  return world;
}

export function computeSkinMatrices(
  skeleton: SkeletonState,
  playback: AnimationPlayback,
): Map<number, Mat4> {
  const world = computeBoneWorldMatrices(skeleton, playback);
  const skin = new Map<number, Mat4>();
  for (const bone of skeleton.bones) {
    const worldMatrix = world.get(bone.index) ?? identityMat4();
    skin.set(bone.index, multiplyMat4(worldMatrix, bone.restMatrix));
  }
  return skin;
}

export function computeBoneWorldMatrix(
  boneIndex: number,
  playback: AnimationPlayback,
  skeleton: SkeletonState,
): Mat4 {
  return computeSkinMatrices(skeleton, playback).get(boneIndex) ?? identityMat4();
}
