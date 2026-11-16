export {
  type PluginCapability,
  ALL_CAPABILITIES,
  SecurityViolationError,
  type CapabilityPolicy,
  createCapabilityPolicy,
  assertCapability,
} from "./capabilities.js";

export {
  PluginSandbox,
  SandboxedContext,
  createPluginSandbox,
  logSandboxViolation,
  type SandboxOptions,
  type SandboxedContextOptions,
} from "./context.js";
