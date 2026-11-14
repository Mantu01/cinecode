export type {
  PluginKind,
  HookName,
  HookDataMap,
  HookHandler,
  HookRunResult,
  PluginManifest,
  PluginHooks,
  PluginContext,
  PluginState,
  RegisteredPlugin,
  CinecodePlugin,
  BeforeRenderHookData,
  AfterRenderHookData,
  BeforeFrameHookData,
  AfterFrameHookData,
  BeforeEncodeHookData,
  AfterEncodeHookData,
  BeforeMixHookData,
  AfterMixHookData,
  ProgressHookData,
  WarningHookData,
  ResolutionChangeHookData,
  OnErrorHookData,
} from "./types.js";
export { HOOK_NAMES } from "./types.js";
export { PluginRegistry, getPluginRegistry, setPluginRegistry, type PluginRegistryOptions } from "./registry.js";
export {
  loadPlugin,
  loadPluginFromFile,
  loadPluginFromPackage,
  parsePluginModule,
  discoverPluginFromPackageJson,
  checkDependencies,
  assertDependencies,
  isCompatibleVersion,
  loadPluginsFromConfig,
  loadProjectPlugins,
  type LoadPluginOptions,
  type PackagePluginInfo,
  type PluginDependencyIssue,
  type PluginConfigEntryLike,
} from "./loader.js";
export {
  discoverPlugins,
  discoverPluginsDetailed,
  readPackageMarker,
  manifestFromPackageJson,
  type DiscoveredPlugin,
  type DiscoveryResult,
} from "./discover.js";
export {
  definePlugin,
  defineManifest,
  hook,
  effectPlugin,
  transitionPlugin,
  audioProcessorPlugin,
  commandPlugin,
  PLUGIN_KINDS,
  type DefinePluginInput,
} from "./sdk.js";

export {
  PluginStateStore,
  pluginStateStore,
  type StoreOptions,
  type ScopedPluginStore,
} from "./store.js";

export {
  TelemetryBroker,
  telemetryBroker,
  scrubPii,
  type TelemetryConfig,
  type TelemetryStatus,
} from "./telemetry.js";

export {
  PluginSandbox,
  createPluginSandbox,
  SecurityViolationError,
  ALL_CAPABILITIES,
  type PluginCapability,
  type CapabilityPolicy,
  createCapabilityPolicy,
} from "./sandbox/index.js";

export {
  checkPluginDeprecation,
  formatDeprecationNotice,
  type DeprecationCheckResult,
} from "./deprecation.js";

export {
  PluginHotReloader,
  type PluginWatcherOptions,
} from "./hot-reload.js";

export {
  scaffoldPlugin,
  type ScaffoldOptions,
  type ScaffoldResult,
  type TemplateType,
} from "./scaffold/index.js";

export {
  MarketplaceClient,
  marketplaceClient,
  installPlugin,
  removePlugin,
  listInstalledPlugins,
  findPluginConfigFile,
  updateConfigPlugins,
  type PluginPackageInfo,
  type PluginSearchResult,
  type InstalledPluginInfo,
} from "./marketplace/index.js";

export {
  verifyPluginSignature,
  signPluginPackage,
  computePackageChecksum,
  OFFICIAL_CINECODE_PUBLIC_KEY,
  type PluginVerificationMode,
  type SignatureVerificationResult,
} from "./security/index.js";

