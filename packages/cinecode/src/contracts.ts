export const CACHE_FORMAT_VERSION = 2;
export const CHECKPOINT_FORMAT_VERSION = 2;
export const MANIFEST_SCHEMA_VERSION = 2;
export const MACHINE_SCHEMA_VERSION = 1;
export const PLUGIN_API_VERSION = "1.0.0";
export const FRAMEWORK_VERSION = "1.0.0";
export const FRAMEWORK_RANGE = "^1.0.0";

export function sameMajorContract(found: string | number, supported: string | number): boolean {
  const foundMajor = typeof found === "number" ? found : Number.parseInt(found.split(".")[0] ?? "", 10);
  const supportedMajor = typeof supported === "number" ? supported : Number.parseInt(supported.split(".")[0] ?? "", 10);
  return Number.isFinite(foundMajor) && foundMajor === supportedMajor;
}
