export type PluginCapability =
  | "fs:read"
  | "fs:write"
  | "network:http"
  | "worker:spawn"
  | "audio:process"
  | "frame:process"
  | "store:read"
  | "store:write"
  | "module:load";

export const ALL_CAPABILITIES: readonly PluginCapability[] = [
  "fs:read",
  "fs:write",
  "network:http",
  "worker:spawn",
  "audio:process",
  "frame:process",
  "store:read",
  "store:write",
  "module:load",
];

export class SecurityViolationError extends Error {
  public readonly code = "CC7001";
  public readonly pluginId: string;
  public readonly requiredCapability: PluginCapability;

  constructor(pluginId: string, requiredCapability: PluginCapability, action: string) {
    super(`[CC7001] Security violation: Plugin '${pluginId}' attempted unauthorized operation '${action}' requiring capability '${requiredCapability}'.`);
    this.name = "SecurityViolationError";
    this.pluginId = pluginId;
    this.requiredCapability = requiredCapability;
  }
}

export interface CapabilityPolicy {
  granted: Set<PluginCapability>;
  allowedDomains?: Set<string>;
  allowedReadPaths?: Set<string>;
  allowedWritePaths?: Set<string>;
  pluginPermissions?: { readonly childProcess?: boolean };
}

export function createCapabilityPolicy(
  granted: PluginCapability[] = [],
  options: {
    allowedDomains?: string[];
    allowedReadPaths?: string[];
    allowedWritePaths?: string[];
    pluginPermissions?: { childProcess?: boolean };
  } = {},
): CapabilityPolicy {
  return {
    granted: new Set(granted),
    allowedDomains: options.allowedDomains ? new Set(options.allowedDomains) : undefined,
    allowedReadPaths: options.allowedReadPaths ? new Set(options.allowedReadPaths) : undefined,
    allowedWritePaths: options.allowedWritePaths ? new Set(options.allowedWritePaths) : undefined,
    pluginPermissions: options.pluginPermissions
      ? { childProcess: options.pluginPermissions.childProcess === true }
      : undefined,
  };
}

export function assertCapability(
  policy: CapabilityPolicy,
  capability: PluginCapability,
  pluginId: string,
  action: string,
): void {
  if (!policy.granted.has(capability)) {
    throw new SecurityViolationError(pluginId, capability, action);
  }
}
