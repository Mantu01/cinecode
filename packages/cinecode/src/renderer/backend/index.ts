export {
  BackendUnavailableError,
  CPU_CAPABILITIES,
  WEBGPU_CAPABILITIES,
  assertSurfaceSize,
  type BackendCapabilities,
  type BackendType,
  type RenderSurface,
} from "./types.js";
export { CpuSurface, createCpuSurface } from "./cpu.js";
export { WebGpuSurface, createWebGpuSurface, probeWebGpu } from "./webgpu.js";
export {
  detectBackend,
  describeBackends,
  forceBackend,
  getBestAvailableBackend,
  getForcedBackend,
  resetBackendDetection,
  type BackendFactoryOptions,
  type BackendSelection,
} from "./factory.js";
