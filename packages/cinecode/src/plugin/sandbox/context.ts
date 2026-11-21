import vm from "node:vm";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import util from "node:util";
import { createRequire } from "node:module";
import { type CapabilityPolicy, type PluginCapability, assertCapability, SecurityViolationError } from "./capabilities.js";
import { PluginStateStore } from "../store.js";
import { registerEffect } from "../../extensions/index.js";
import { logger } from "../../observability/logger.js";

const nodeRequire = createRequire(import.meta.url);

export interface SandboxOptions {
  pluginId: string;
  policy: CapabilityPolicy;
  projectRoot?: string;
  cacheDir?: string;
}

const DENIED_GLOBALS = new Set(["require", "import", "process", "global", "setTimeout", "setInterval"]);
const ALLOWED_MODULES = new Set(["path", "fs/promises", "crypto", "util", "events"]);
const DENIED_CODE_PATTERN = /(?<![\w$.])(process|global)\b|(?<![\w$.])import\s*\(/;

export interface SandboxedContextOptions {
  readonly pluginId: string;
  readonly policy: CapabilityPolicy;
  readonly globals: Record<string, unknown>;
}

export interface SandboxModuleRequest {
  readonly moduleName: string;
}

/** vm context wrapper: strips denied globals, intercepts require, pre-scans source. */
export class SandboxedContext {
  readonly vmContext: vm.Context;
  private readonly options: SandboxedContextOptions;

  constructor(options: SandboxedContextOptions) {
    this.options = options;
    const safeGlobals: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options.globals)) {
      if (DENIED_GLOBALS.has(key)) continue;
      safeGlobals[key] = value;
    }
    safeGlobals.require = (moduleName: string): unknown => this.interceptRequire(moduleName);
    this.vmContext = vm.createContext(safeGlobals, {
      codeGeneration: { strings: false, wasm: false },
    });
  }

  run<T = unknown>(code: string, filename: string): T {
    this.assertNoDeniedGlobals(code);
    const script = new vm.Script(code, { filename });
    return script.runInContext(this.vmContext) as T;
  }

  private assertNoDeniedGlobals(code: string): void {
    const match = DENIED_CODE_PATTERN.exec(code);
    if (!match) return;
    const token = match[1] ?? "dynamic import";
    throw new SecurityViolationError(
      this.options.pluginId,
      "module:load",
      `Plugin code references denied global '${token}'`,
    );
  }

  private interceptRequire(moduleName: string): unknown {
    if (moduleName === "child_process" || moduleName === "node:child_process") {
      if (this.options.policy.pluginPermissions?.childProcess === true) return nodeRequire("node:child_process");
      throw new SecurityViolationError(
        this.options.pluginId,
        "module:load",
        "child_process access requires pluginPermissions.childProcess",
      );
    }
    const bare = moduleName.startsWith("node:") ? moduleName.slice(5) : moduleName;
    if (!ALLOWED_MODULES.has(bare)) {
      throw new SecurityViolationError(
        this.options.pluginId,
        "module:load",
        `Module '${moduleName}' is not in the sandbox allowlist (${[...ALLOWED_MODULES].join(", ")})`,
      );
    }
    assertCapability(this.options.policy, "module:load", this.options.pluginId, `require(${moduleName})`);
    return createModuleSurface(bare, this.options);
  }
}

export function logSandboxViolation(pluginId: string, action: string, error: SecurityViolationError): void {
  logger.warn("plugin-sandbox", `Security violation from plugin '${pluginId}': ${action}`, {
    pluginId,
    capability: error.requiredCapability,
    message: error.message,
  });
}

function createModuleSurface(bare: string, options: SandboxedContextOptions): unknown {
  switch (bare) {
    case "path":
      return path;
    case "crypto":
      return crypto;
    case "util":
      return util;
    case "events":
      return nodeRequire("node:events");
    case "fs/promises":
      return createGatedFsPromises(options);
    default:
      throw new SecurityViolationError(options.pluginId, "module:load", `No safe surface for module '${bare}'`);
  }
}

function createGatedFsPromises(options: SandboxedContextOptions): {
  readonly readFile: (filePath: string, encoding?: BufferEncoding) => Promise<string | Buffer>;
  readonly writeFile: (filePath: string, data: string | Uint8Array) => Promise<void>;
  readonly stat: (filePath: string) => Promise<{ size: number; isFile: boolean }>;
} {
  const { pluginId, policy } = options;
  return {
    readFile: async (filePath, encoding) => {
      assertCapability(policy, "fs:read", pluginId, `fs.promises.readFile(${filePath})`);
      return fsp.readFile(filePath, encoding ?? null) as Promise<string | Buffer>;
    },
    writeFile: async (filePath, data) => {
      assertCapability(policy, "fs:write", pluginId, `fs.promises.writeFile(${filePath})`);
      await fsp.writeFile(filePath, data);
    },
    stat: async (filePath) => {
      assertCapability(policy, "fs:read", pluginId, `fs.promises.stat(${filePath})`);
      const info = await fsp.stat(filePath);
      return { size: info.size, isFile: info.isFile() };
    },
  };
}

export class PluginSandbox {
  public readonly pluginId: string;
  public readonly policy: CapabilityPolicy;
  private readonly sandboxedContext: SandboxedContext;
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
        return fs.readFileSync(resolved, encoding as BufferEncoding);
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
      registerEffect: (effect: unknown) => {
        registerEffect(effect as Parameters<typeof registerEffect>[0]);
      },
      log: (msg: string) => {
        logger.debug("plugin", `[Plugin:${this.pluginId}] ${msg}`);
      },
      store: this.store.for(this.pluginId),
      events: {
        emit: (event: string, payload: unknown) => this.store.emit(event, payload),
        on: (event: string, handler: (payload: unknown) => void) => this.store.on(event, handler),
      },
      telemetry: {
        record: (_event: string, _payload: Record<string, unknown> = {}) => {
          // offline no-op
        },
      },
      fs: safeFs,
      fetch: safeFetch,
    };

    const sandboxGlobals: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => logger.debug(`plugin:${this.pluginId}`, args.map(String).join(" ")),
        warn: (...args: unknown[]) => logger.warn(`plugin:${this.pluginId}`, args.map(String).join(" ")),
        error: (...args: unknown[]) => logger.error(`plugin:${this.pluginId}`, args.map(String).join(" ")),
        info: (...args: unknown[]) => logger.info(`plugin:${this.pluginId}`, args.map(String).join(" ")),
      },
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Buffer,
      cinecode: cinecodeSdk,
      module: { exports: {} },
      exports: {},
    };

    this.sandboxedContext = new SandboxedContext({
      pluginId: this.pluginId,
      policy: this.policy,
      globals: sandboxGlobals,
    });
  }

  public runCode<T = unknown>(code: string, filename = `${this.pluginId}.js`): T {
    try {
      return this.sandboxedContext.run<T>(code, filename);
    } catch (error) {
      if (error instanceof SecurityViolationError) {
        logSandboxViolation(this.pluginId, filename, error);
      }
      throw error;
    }
  }

  public getContext(): vm.Context {
    return this.sandboxedContext.vmContext;
  }
}

export function createPluginSandbox(options: SandboxOptions): PluginSandbox {
  return new PluginSandbox(options);
}

export type { PluginCapability };
