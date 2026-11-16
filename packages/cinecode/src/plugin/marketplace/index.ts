export {
  MarketplaceClient,
  marketplaceClient,
  PluginRegistryClient,
  pluginRegistryClient,
  type PluginPackageInfo,
  type PluginFilters,
  type PluginSearchResult,
  type PluginPackageDownload,
} from "./client.js";

export {
  installPlugin,
  removePlugin,
  listInstalledPlugins,
  findPluginConfigFile,
  updateConfigPlugins,
  type InstalledPluginInfo,
} from "./installer.js";
