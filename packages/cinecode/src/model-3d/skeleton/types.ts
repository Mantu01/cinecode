export type Mat4 = Float32Array;
export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

export type BoneTargetType = "translation" | "rotation" | "scale";
export type InterpolationMode = "LINEAR" | "STEP" | "CUBICSPLINE";

export interface Bone {
  readonly name: string;
  readonly index: number;
  readonly parentIndex?: number;
  readonly restMatrix: Mat4;
  readonly baseTranslation: Vec3;
  readonly baseRotation: Quat;
  readonly baseScale: Vec3;
  readonly children: readonly number[];
}

export interface AnimationChannel {
  readonly targetBoneIndex: number;
  readonly targetType: BoneTargetType;
  readonly inputTimes: Float32Array;
  readonly outputValues: Float32Array;
  readonly interpolation: InterpolationMode;
}

export interface AnimationClip {
  readonly name: string;
  readonly duration: number;
  readonly channels: readonly AnimationChannel[];
}

export interface SkeletonState {
  readonly bones: readonly Bone[];
  readonly boneByNode: ReadonlyMap<number, Bone>;
  readonly animClips: readonly AnimationClip[];
  readonly rootBones: readonly number[];
}

export interface SkinBinding {
  readonly joints: readonly number[];
  readonly inverseBindMatrices: readonly Mat4[];
  readonly skeletonRoot?: number;
}

export interface SkinnedVertexData {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly boneIndices: Float32Array;
  readonly boneWeights: Float32Array;
}
