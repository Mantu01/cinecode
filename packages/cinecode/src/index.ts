export const CINECODE_VERSION = "0.0.0";

export * from "./core/index.js";
export { renderFrame, renderStill, renderSplitScreen, type RenderContext, type RenderResult } from "./renderer/engine.js";
export {
  resolveRegions, resolveLayout, computeFitRect, drawSourceIntoRegion, drawRegionShadow,
  createSideBySide, createPiP, createGrid, createThirds,
  type SplitRegion, type ResolvedRegion, type SplitLayoutPreset, type RegionFit, type FitRect,
} from "./renderer/pip.js";
export { renderImageClip, renderImageBuffer, type RenderImageOptions, type RenderImageBufferOptions } from "./renderer/image.js";
export {
  renderMultiCameraFrame, renderMultiCameraView, renderMultiCameraPreview, compositeCameraTransition,
  type MultiCameraRenderOptions, type MultiCameraPreviewOptions,
} from "./renderer/multi-camera.js";
export { measureTextWidth, layoutTextLetters, type TextMeasureStyle, type TextLetter, type TextLetterLayout } from "./renderer/text/measure.js";
export { createCanvas, createContext, clearCanvas, compositeLayers, copyCanvas, applyOpacity, compositeCanvases, convertCanvasAlphaMode, type CompositedLayer, type Mask, type Matte, type MaskShape, type CanvasCompositeOptions } from "./renderer/composite/engine.js";
export {
  premultiplyAlpha, unpremultiplyAlpha, convertAlphaMode, compositeBuffers, applyBufferOpacity, porterDuffPixel,
  canvasOperationForPorterDuff,
  type AlphaMode, type PorterDuffOperator, type BufferCompositeOptions,
} from "./renderer/composite/porter-duff.js";
export {
  createDefaultTransform, applyTransform, applyBlendMode,
  drawRectangle, drawRoundedRectangle, drawEllipse, drawLine, drawPolygon, drawPath,
  type Point, type Size, type Rect, type Fill, type Stroke, type Shadow, type Transform,
  type BlendMode, type DrawContext, type ShapeDrawParams, type PathSegment,
} from "./renderer/shapes/index.js";
export {
  regularPolygon, star, arc, ring, spiral, grid, morphingPolygon, pointsToClosedPath,
} from "./renderer/geometry.js";
export { createCanvasPool, createBufferPool, type CanvasPool, type CanvasPoolEntry, type BufferPool } from "./renderer/pool.js";
export {
  buildFrame, createDrawList, withDrawList,
  type FrameBuilder, type FrameDrawContext, type DrawOp, type DrawList,
} from "./renderer/frame-builder.js";
export {
  oscillate, triangle, saw, bounce, springTo, spin, noiseDrift, noiseWander, lissajous, pulse, remap,
} from "./renderer/motion.js";
export {
  cycle, pingPong, hold, progress, timeScope, loopScope, nestedScope, beat,
  type TimeScopeOptions,
} from "./renderer/loops.js";
export {
  poseSkeleton, drawSkeleton, humanoidSkeleton,
  type Bone, type Skeleton, type Pose, type JointPositions, type SkeletonAnchor, type DrawSkeletonParams,
} from "./renderer/skeleton.js";
export * from "./effects/index.js";
export * from "./transitions/index.js";
export * from "./media/index.js";
export * from "./audio/index.js";
export * from "./config/schema.js";
export {
  substituteEnvVars,
  substituteEnvVarsDeep,
  substituteEnvVarsWithReport,
  findMissingEnvVars,
  findMissingEnvVarsDeep,
} from "./config/envsubst.js";
export {
  resolveConfigChain,
  mergeConfigInheritance,
  deepMergeConfig,
  extendComposition,
  extendCompositionProps,
} from "./config/inherit.js";
export { generateSchema, generateSchemaJson } from "./config/json-schema.js";
export {
  CinecodeIgnore,
  DEFAULT_IGNORE_PATTERNS,
  loadCinecodeIgnore,
  parseIgnoreContent,
} from "./config/ignore.js";
export {
  defineConfig,
  scaffoldConfigFile,
} from "./config/scaffold.js";
export {
  ConfigMigrationEngine,
} from "./config/migration/engine.js";
export {
  validateConfigWithZod,
  CinecodeConfigSchema,
} from "./config/zod-schema.js";
export {
  ConfigDependencyTracker,
} from "./config/hot-swap.js";
export type { CinecodeIgnoreOptions, IgnoreRule, JsonSchemaDocument, JsonSchemaNode } from "./config/index.js";
export * from "./manifest/index.js";
export * from "./dev/index.js";
export * from "./canvas-interact/index.js";
export * from "./cli/index.js";
export * from "./pipeline/index.js";
export * from "./encoder/index.js";
export * from "./plugin/index.js";
export * from "./extensions/index.js";
export * from "./noise/index.js";
export * from "./subtitles/index.js";
export * from "./stickers/index.js";
export * from "./gradients/index.js";
export * from "./warp/index.js";
export * from "./text-3d/index.js";
export {
  buildSkinBindings as buildGltfSkinBindings,
  parseAnimationClips as parseGltfAnimationClips,
  applySkinning as applyGltfSkinning,
} from "./model-3d/skeleton/index.js";
export {
  loadCubeMap, loadEquirectangular, renderSkybox, createProceduralSkybox, sampleEnvMap,
  type CubeTexture, type CubeFace,
} from "./model-3d/environment/index.js";
export {
  renderShadowMap, applyShadowMap, drawGroundPlane, createGroundPlaneCanvas,
  projectPointToGround, sampleShadow,
  type ShadowMap, type GroundPlaneOptions,
} from "./model-3d/shadows/index.js";
export * from "./dataviz/index.js";
export * from "./svg/index.js";
export {
  Model3dRenderer, parseGLB, getAccessorData, buildSkeletonState, buildSkinBindings,
  parseAnimationClips, applySkinning, computeBoneWorldMatrices, computeSkinMatrices,
  sampleChannel, quatMultiply, quatSlerp, quatNormalize,
  type Model3dOptions, type CameraConfig, type SkeletalAnimationConfig,
  type SkeletonState, type AnimationClip as SkeletalAnimationClip, type SkinBinding,
  type AnimationChannel as SkeletalAnimationChannel, type SkinnedMeshResult,
} from "./model-3d/index.js";
export * from "./particles/index.js";
export * from "./midi/index.js";
export * from "./tts/index.js";
export * from "./api/index.js";
export * from "./observability/index.js";
export * from "./security/index.js";
