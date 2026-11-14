import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { type CapabilityPolicy, type PluginCapability, assertCapability, SecurityViolationError } from "./capabilities.js";
import { PluginStateStore } from "../store.js";
import { telemetryBroker } from "../telemetry.js";
import { registerEffect } from "../../extensions/index.js";

export interface SandboxOptions {
  pluginId: string;
  policy: CapabilityPolicy;
  projectRoot?: string;
  cacheDir?: string;
}

export class PluginSandbox {
  public readonly pluginId: string;
  public readonly policy: CapabilityPolicy;
  private readonly context: vm.Context;
  private readonly store = PluginStateStore.getInstance();

  constructor(options: SandboxOptions) {
    this.pluginId = options.pluginId;
    this.policy = options.policy;

    const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
    const cacheDir = options.cacheDir
      ? path.resolve(options.cacheDir)
      : path.join(projectRoot, ".cinecode", "cache", "plugins", options.pluginId);

    const safeFs = {
      readFileSync: (filePath: string, encoding?: BufferEncoding): string | Buffer => {
        assertCapability(this.policy, "fs:read", this.pluginId, `fs.readFileSync(${filePath})`);
        const resolved = path.resolve(projectRoot, filePath);
        if (!resolved.startsWith(projectRoot)) {
          throw new SecurityViolationError(this.pluginId, "fs:read", `Path escape attempt: ${filePath}`);
        }
        return fs.readFileSync(resolved, encoding as any);
      },
      writeFileSync: (filePath: string, data: string | Uint8Array): void => {
        assertCapability(this.policy, "fs:write", this.pluginId, `fs.writeFileSync(${filePath})`);
        const resolved = path.resolve(cacheDir, filePath);
        if (!resolved.startsWith(cacheDir)) {
          throw new SecurityViolationError(this.pluginId, "fs:write", `Write outside cache dir: ${filePath}`);
        }
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, data);
      },
      existsSync: (filePath: string): boolean => {
        assertCapability(this.policy, "fs:read", this.pluginId, `fs.existsSync(${filePath})`);
        const resolved = path.resolve(projectRoot, filePath);
        return resolved.startsWith(projectRoot) && fs.existsSync(resolved);
      },
    };

    const safeFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      assertCapability(this.policy, "network:http", this.pluginId, `fetch(${url.toString()})`);
      const parsedUrl = new URL(url.toString());
      if (this.policy.allowedDomains && !this.policy.allowedDomains.has(parsedUrl.hostname)) {
        throw new SecurityViolationError(
          this.pluginId,
          "network:http",
          `Outbound domain ${parsedUrl.hostname} not in allowed domains list`,
        );
      }
      return fetch(url, init);
    };

    const cinecodeSdk = {
      pluginId: this.pluginId,
      registerEffect: (effect: any) => {
        registerEffect(effect);
      },
      log: (msg: string) => {
        console.log(`[Plugin:${this.pluginId}] ${msg}`);
      },
      store: this.store.for(this.pluginId),
      events: {
        emit: (event: string, payload: unknown) => this.store.emit(event, payload),
        on: (event: string, handler: (payload: unknown) => void) => this.store.on(event, handler),
      },
      telemetry: {
        record: (event: string, payload: Record<string, unknown> = {}) => {
          return telemetryBroker.record(`plugin:${this.pluginId}:${event}`, payload);
        },
      },
      fs: safeFs,
      fetch: safeFetch,
    };

    const sandboxGlobals: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => console.log(`[Plugin:${this.pluginId}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[Plugin:${this.pluginId}]`, ...args),
        error: (...args: unknown[]) => console.error(`[Plugin:${this.pluginId}]`, ...args),
        info: (...args: unknown[]) => console.info(`[Plugin:${this.pluginId}]`, ...args),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Buffer,
      cinecode: cinecodeSdk,
      module: { exports: {} },
      exports: {},
    };

    this.context = vm.createContext(sandboxGlobals);
  }

  public runCode<T = unknown>(code: string, filename = `${this.pluginId}.js`): T {
    const script = new vm.Script(code, { filename });
    return script.runInContext(this.context) as T;
  }

  public getContext(): vm.Context {
    return this.context;
  }
}

export function createPluginSandbox(options: SandboxOptions): PluginSandbox {
  return new PluginSandbox(options);
}
