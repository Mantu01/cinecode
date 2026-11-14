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
  createPluginSandbox,
  type SandboxOptions,
} from "./context.js";
