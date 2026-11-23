export {
  createRenderCache,
  RenderCache,
  computeCompositionHash,
  computeCanonicalCacheIdentity,
  findFunctionValuedProperty,
  canonicalJsonString,
  computeDescriptorHash,
  createFrameCacheDescriptor,
  fingerprintMediaFile,
  objectPath,
  type FrameCacheDescriptor,
  type FrameCacheIndex,
  type MediaFingerprint,
  type RenderCacheEntry,
  type RenderCacheStats,
  type CacheGcOptions,
  type CacheGcResult,
  type CacheIdentityInputs,
} from "./cache.js";
export {
  collectFrameCacheGarbage,
  enforceCacheQuota,
  formatCacheGcResult,
  pruneStaleEntries,
  DEFAULT_CACHE_MAX_BYTES,
} from "./cache-gc.js";
export {
  createWorkerManager,
  createChunks,
  resolveConcurrency,
  WorkerManager,
  type WorkerManagerOptions,
  type FrameChunk,
  type WorkerResult,
  type WorkerStartupMeasurement,
  type WorkerThroughputMeasurement,
} from "./workers.js";
export {
  createResumeManager,
  type ResumeManager,
  type ResumeState,
  type ChunkState,
} from "./resume.js";
export {
  createProgressReporter,
  formatTime,
  type ProgressReporter,
  type ProgressEvent,
  type ProgressHandler,
  type ProgressReporterOptions,
  type RenderStage,
} from "./progress.js";
export {
  createRenderProfiler,
  estimateRenderTimeMs,
  shouldLog,
  type RenderProfiler,
  type RenderProfile,
  type StageTiming,
  type ProfilableStage,
  type LogLevel,
} from "./profiling.js";
export {
  buildRenderGraph,
  serializeRenderGraph,
  type RenderGraph,
  type RenderGraphNode,
  type RenderGraphFrame,
} from "./graph.js";
export {
  CheckpointManager,
  createCheckpointManager,
  encodeFrameBitmask,
  decodeFrameBitmask,
  absoluteToRelative,
  relativeToAbsolute,
  type RenderCheckpoint,
  type CheckpointManagerOptions,
  type EncoderCheckpointState,
  type AudioCheckpointState,
} from "./checkpoint.js";
export {
  tuneConcurrency,
  tuneConcurrencyForComposition,
  analyzeWorkload,
  createConcurrencyTuner,
  ConcurrencyTuner,
  type WorkloadClass,
  type WorkloadProfile,
  type TuningLimits,
  type TuningResult,
} from "./concurrency-tuner.js";
export {
  withRecovery,
  renderFrameWithRecovery,
  createFallbackFrameBuffer,
  resolveStrategy,
  DEFAULT_RECOVERY,
  type RecoveryStrategy,
  type RecoveryPolicy,
  type RecoveryOutcome,
  type FailurePhase,
  type FrameRenderOutcome,
} from "./recovery.js";
export { GracefulDrainManager, type DrainOptions } from "./drain.js";
export { TenantContext, DEFAULT_TENANT_QUOTA, type TenantQuota } from "./tenant.js";
export {
  createSharedDecodeService,
  type SharedDecodeService,
  type DecodedFrame,
  type DecodeServiceStats,
} from "../media/decode-service.js";
export {
  createResourcePlan,
  type ResourcePlan,
  type ResourcePlanInput,
  type CachePartitionSizes,
} from "./resource-planner.js";
export {
  GlobalCacheService,
  CachePartition,
  buildContractCacheKey,
  getGlobalCacheService,
  setGlobalCacheService,
  type CacheKeyContract,
  type GlobalCacheStats,
  type PartitionStats,
  type GlobalCacheEntry,
} from "./global-cache.js";
export {
  ByteBudget,
  resolveTransportBudget,
  estimateFrameBytes,
  formatBytes,
  createMemoryBudget,
  type TransportBudget,
  type TransportBudgetInput,
  type MemoryBudget,
  type MemoryBudgetOptions,
  type ReservationOutcome,
} from "./memory.js";
