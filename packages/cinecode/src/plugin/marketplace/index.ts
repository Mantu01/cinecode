export {
  MarketplaceClient,
  marketplaceClient,
  type PluginPackageInfo,
  type PluginFilters,
  type PluginSearchResult,
} from "./client.js";

export {
  installPlugin,
  removePlugin,
  listInstalledPlugins,
  findPluginConfigFile,
  updateConfigPlugins,
  type InstalledPluginInfo,
} from "./installer.js";
