export { parseGLB, getAccessorData } from "./gltf-parser.js";
export { buildSkeletonState, buildSkinBindings, parseAnimationClips } from "./skeleton/parse.js";
export { applySkinning, type SkinnedMeshResult } from "./skeleton/animateMesh.js";
export {
  computeBoneWorldMatrices, computeSkinMatrices, computeBoneWorldMatrix,
  sampleChannel, quatMultiply, quatSlerp, quatNormalize, mat4FromQuat,
  mat4FromTrs, multiplyMat4, identityMat4,
  type AnimationPlayback,
} from "./skeleton/skinning.js";
export type {
  Bone, AnimationChannel, AnimationClip, SkeletonState, SkinBinding,
  Mat4, Quat, Vec3, SkinnedVertexData, BoneTargetType, InterpolationMode,
} from "./skeleton/types.js";
export type {
  GLTFBuffer,
  GLTFAccessor,
  GLTFBufferView,
  GLTFMeshPrimitive,
  GLTFMesh,
  GLTFMaterial,
  GLTFNode,
  GLTFScene,
  GLTFSampler,
  GLTFTexture,
  GLTFAnimation,
  GLTFAnimationChannel,
  GLTFAnimationSampler,
  GLTFAPI,
} from "./gltf-parser.js";

export {
  decodeMetallicRoughnessTexture, decodeNormalMap, decodeCanvasNormalMap,
  decodeCanvasMetallicRoughness, sampleTextureAt, sampleChannelAt, sampleNormalAt,
} from "./materials/decode.js";
export { pbrShade, pbrShadeContext, computeVertexColors, resolveLight } from "./materials/pbr.js";
export { DEFAULT_MATERIAL } from "./materials/types.js";
export type {
  PBRMaterial, PbrLight, PbrContext, PbrEnvironment, RgbaColor, RgbColor,
  DecodedMetallicRoughness, DecodedNormalMap, AlphaMode,
} from "./materials/types.js";
export { applyMaterialOverride, resolveMaterialOverrides } from "./materials/override.js";
export type { MaterialSlotOverride } from "./materials/types.js";

export {
  projectToSH, evalSH, rotateSH, rotateVectorByEuler, scaleSH, computeSHFromCubeMap,
} from "./environment/sh.js";
export type { SH9 } from "./environment/sh.js";
export {
  calculatePCSS, pcssShadowFactor, POISSON_DISK_32,
} from "./shadows/soft-shadows.js";
export type { PCSSOptions, PCSSResult, PoissonDiskSample } from "./shadows/soft-shadows.js";
export type { DepthBuffer } from "./depth-pass.js";
export {
  linearizeDepth, calculateCoC, depthBufferToCanvas,
} from "./depth-pass.js";

export {
  createPrimitiveMesh,
  createIcosahedron,
  createTorusKnot,
  createHyperboloid,
  createMobiusStrip,
  createSpirographRibbon,
  createVoronoiMesh,
  buildMesh,
  computeTangents,
  type MeshGeometry,
  type PrimitiveType,
  type PrimitiveMeshOptions,
} from "./primitives/index.js";

export {
  parsePointCloud,
  parseCsvPointCloud,
  parseJsonPointCloud,
  parseXyzPointCloud,
  parsePcdPointCloud,
  PointCloudRenderer,
  PointCloudOctree,
  samplePalette,
  type PointCloudData,
  type PointCloudRenderOptions,
  type ColorPaletteName,
  type PointCloudPoint,
  type PointCloudBounds,
  type ClippingPlane,
} from "./point-cloud/index.js";

export {
  createTessellatedGrid,
  createTessellatedSphere,
  displaceMesh,
  displaceCanvas,
  createImageHeightmapSampler,
  createWaterWaveSampler,
  createPerlinHeightmapSampler,
  type HeightmapSampler,
  type WaveOctave,
  type DisplacementOptions,
  type TessellatedGridOptions,
  type TessellatedSphereOptions,
} from "./displacement.js";

export {
  RaymarchEngine,
  sphereTrace,
  computeNormal,
  computeAO,
  sdSphere,
  sdBox,
  sdRoundCylinder,
  sdTorus,
  sdCone,
  sdPlane,
  sdMandelbulb,
  sdJulia3D,
  sdMengerSponge,
  sdMetaballs,
  opUnion,
  opIntersection,
  opSubtraction,
  opSmoothUnion,
  opSmoothSubtraction,
  opSmoothIntersection,
  opRepetition,
  opLimitedRepetition,
  type SDFEvaluator,
  type RaymarchOptions,
  type RaymarchHit,
} from "./raymarch/index.js";

export { Model3dRenderer } from "./renderer.js";
export type {
  Model3dOptions,
  CameraConfig,
  LightingConfig,
  AnimationConfig,
  SkeletalAnimationConfig,
  Point3d,
  Model3dResult,
} from "./renderer.js";
