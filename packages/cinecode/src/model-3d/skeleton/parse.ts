import type { GLTFAPI, GLTFNode } from "../gltf-parser.js";
import { getAccessorData } from "../gltf-parser.js";
import type {
  AnimationChannel,
  AnimationClip,
  Bone,
  BoneTargetType,
  InterpolationMode,
  Mat4,
  Quat,
  SkeletonState,
  SkinBinding,
  Vec3,
} from "./types.js";

const IDENTITY: Mat4 = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function buildParentMap(nodes: readonly GLTFNode[]): Map<number, number> {
  const parents = new Map<number, number>();
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parents.set(child, index);
  });
  return parents;
}

function readInverseBind(api: GLTFAPI, accessorIndex: number | undefined, joints: readonly number[]): Mat4[] {
  if (accessorIndex === undefined) {
    return joints.map(() => Float32Array.from(IDENTITY));
  }
  const data = getAccessorData(api, accessorIndex);
  const matrices: Mat4[] = [];
  for (let i = 0; i < joints.length; i += 1) {
    matrices.push(Float32Array.from(data.subarray(i * 16, i * 16 + 16) as unknown as ArrayLike<number>));
  }
  return matrices;
}

export function buildSkinBindings(api: GLTFAPI): SkinBinding[] {
  return api.skins.map((skin) => ({
    joints: skin.joints,
    inverseBindMatrices: readInverseBind(api, skin.inverseBindMatrices, skin.joints),
    skeletonRoot: skin.skeleton,
  }));
}

function toVec3(value: readonly number[] | undefined, fallback: Vec3): Vec3 {
  if (!value || value.length < 3) return fallback;
  return [value[0]!, value[1]!, value[2]!];
}

function toQuat(value: readonly number[] | undefined): Quat {
  if (!value || value.length < 4) return [0, 0, 0, 1];
  return [value[0]!, value[1]!, value[2]!, value[3]!];
}

export function buildSkeletonState(api: GLTFAPI, skinIndex = 0): SkeletonState | null {
  const skin = api.skins[skinIndex];
  if (!skin) return null;
  const parents = buildParentMap(api.nodes);
  const bindings = readInverseBind(api, skin.inverseBindMatrices, skin.joints);

  const bones: Bone[] = skin.joints.map((nodeIndex, jointIndex) => {
    const node = api.nodes[nodeIndex];
    return {
      name: node?.name ?? `joint-${jointIndex}`,
      index: nodeIndex,
      parentIndex: parents.get(nodeIndex),
      restMatrix: bindings[jointIndex] ?? Float32Array.from(IDENTITY),
      baseTranslation: toVec3(node?.translation, [0, 0, 0]),
      baseRotation: toQuat(node?.rotation),
      baseScale: toVec3(node?.scale, [1, 1, 1]),
      children: node?.children ?? [],
    };
  });

  const boneByNode = new Map<number, Bone>();
  for (const bone of bones) boneByNode.set(bone.index, bone);

  const rootBones = bones.filter((bone) => bone.parentIndex === undefined || !boneByNode.has(bone.parentIndex)).map((bone) => bone.index);

  return {
    bones,
    boneByNode,
    animClips: parseAnimationClips(api),
    rootBones,
  };
}

export function parseAnimationClips(api: GLTFAPI): AnimationClip[] {
  const animations = api.animations ?? [];
  return animations.map((animation, index) => {
    const channels: AnimationChannel[] = [];
    let duration = 0;
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      if (!sampler) continue;
      if (channel.target.path === "weights") continue;
      const times = Float32Array.from(getAccessorData(api, sampler.input) as unknown as ArrayLike<number>);
      const values = Float32Array.from(getAccessorData(api, sampler.output) as unknown as ArrayLike<number>);
      if (times.length === 0) continue;
      duration = Math.max(duration, times[times.length - 1]!);
      channels.push({
        targetBoneIndex: channel.target.node,
        targetType: channel.target.path as BoneTargetType,
        inputTimes: times,
        outputValues: values,
        interpolation: (sampler.interpolation ?? "LINEAR") as InterpolationMode,
      });
    }
    return {
      name: animation.name ?? `animation-${index}`,
      duration,
      channels,
    };
  });
}
