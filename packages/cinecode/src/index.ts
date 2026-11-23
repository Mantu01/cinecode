export { CINECODE_VERSION } from "./version.js";

// Authoring types, time, easing, keyframes, random, validation, define, clips & builders
export * from "./core/index.js";

// Definition helpers
export { defineEffect } from "./effects/engine.js";
export type { EffectDefinition } from "./effects/engine.js";
export {
  defineTransition,
  BUILTIN_TRANSITION_NAMES,
} from "./transitions/index.js";
export type { TransitionDefinition } from "./transitions/index.js";
export { defineConfig } from "./core/define/definitions.js";
export {
  definePlugin,
  defineManifest,
  hook,
  effectPlugin,
  transitionPlugin,
  audioProcessorPlugin,
  commandPlugin,
} from "./plugin/sdk.js";
export type {
  CinecodePlugin,
  PluginManifest,
  PluginHooks,
} from "./plugin/types.js";

// Render API & Canvas rendering
export { render } from "./api/render.js";
export type { RenderApiOptions, RenderApiResult } from "./api/render.js";
export {
  renderFrame,
  renderStill,
  renderSplitScreen,
} from "./renderer/engine.js";
export type { RenderContext, RenderResult } from "./renderer/engine.js";
export {
  buildFrame,
  createDrawList,
  withDrawList,
} from "./renderer/frame-builder.js";
export type {
  FrameBuilder,
  FrameDrawContext,
  DrawOp,
  DrawList,
} from "./renderer/frame-builder.js";
export {
  anchorPosition,
  layoutRow,
  layoutColumn,
  layoutStack,
} from "./renderer/layout/engine.js";
export type {
  LayoutItem,
  LayoutOptions,
  LayoutResult,
} from "./renderer/layout/engine.js";
export {
  createSideBySide,
  createPiP,
  createGrid,
  createThirds,
} from "./renderer/pip.js";
export type {
  SplitRegion,
  ResolvedRegion,
  SplitLayoutPreset,
} from "./renderer/pip.js";
export {
  renderMultiCameraFrame,
  renderMultiCameraView,
  renderMultiCameraPreview,
} from "./renderer/multi-camera.js";
export type {
  MultiCameraRenderOptions,
  MultiCameraPreviewOptions,
} from "./renderer/multi-camera.js";

// Motion & loops helpers
export {
  oscillate,
  triangle,
  saw,
  bounce,
  springTo,
  spin,
  noiseDrift,
  noiseWander,
  lissajous,
  pulse,
  remap,
} from "./renderer/motion.js";
export {
  cycle,
  pingPong,
  hold,
  progress,
  timeScope,
  loopScope,
  nestedScope,
  beat,
} from "./renderer/loops.js";
export type { TimeScopeOptions } from "./renderer/loops.js";

// Config API
export { loadConfig } from "./config/schema.js";
export type { LoadConfigOptions } from "./config/schema.js";
export {
  validateConfigWithZod,
  CinecodeConfigSchema,
} from "./config/zod-schema.js";
export type { InferredCinecodeConfig } from "./config/zod-schema.js";
export { generateSchema, generateSchemaJson } from "./config/json-schema.js";
export {
  CinecodeIgnore,
  DEFAULT_IGNORE_PATTERNS,
  loadCinecodeIgnore,
  parseIgnoreContent,
} from "./config/ignore.js";
export type { CinecodeIgnoreOptions, IgnoreRule } from "./config/ignore.js";
export { ConfigMigrationEngine } from "./config/migration/engine.js";

// Pipeline, Caches & Resource Plan
export {
  createResourcePlan,
} from "./pipeline/resource-planner.js";
export type {
  ResourcePlan,
  ResourcePlanInput,
} from "./pipeline/resource-planner.js";
export {
  GlobalCacheService,
  getGlobalCacheService,
  buildContractCacheKey,
} from "./pipeline/global-cache.js";
export {
  ByteBudget,
  resolveTransportBudget,
  estimateFrameBytes,
  formatBytes,
} from "./pipeline/memory.js";

// Error API
export {
  ErrorCode,
  ErrorMessages,
  FIX_HINTS,
  createError,
  isCinecodeError,
  formatError,
} from "./errors/codes.js";
export type { CinecodeError } from "./errors/codes.js";
export {
  recordDegradation,
  pendingDegradations,
} from "./errors/degradations.js";
export type { Degradation } from "./errors/degradations.js";
export { exitCodeForError, EXIT_CODES } from "./cli/shared/exit-codes.js";

// Binary resolution
export {
  resolveBinary,
  setBinaryConfig,
  getBinaryConfig,
} from "./binary/resolver.js";
export type { BinaryResolution } from "./binary/resolver.js";

// Observability
export {
  StructuredLogger,
  logger,
  setJsonMode,
  log,
} from "./observability/index.js";
export type {
  LogFormat,
  LogEntry,
  LoggerOptions,
  StructuredLogLevel,
} from "./observability/index.js";
