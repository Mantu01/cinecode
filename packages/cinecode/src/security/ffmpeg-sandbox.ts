import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export interface SafeSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowedBaseDirs?: string[];
}

export class FfmpegSandbox {
  static validatePath(filePath: string, allowedDirs: string[] = []): string {
    if (filePath.includes("\0")) {
      throw new Error(`Security violation: Null byte detected in file path '${filePath}'`);
    }

    const normalized = path.normalize(filePath);
    if (allowedDirs.length > 0) {
      const isAllowed = allowedDirs.some((dir) => normalized.startsWith(path.resolve(dir)));
      if (!isAllowed) {
        throw new Error(`Security violation: Path traversal outside allowed directories: '${filePath}'`);
      }
    }
    return normalized;
  }

  static sanitizeMetadataValue(val: string): string {
    return val.replace(/[\r\n\0]/g, " ").replace(/"/g, '\\"');
  }

  static spawnSafe(
    binaryPath: string,
    args: readonly string[],
    options: SafeSpawnOptions = {},
  ): ChildProcess {
    FfmpegSandbox.validatePath(binaryPath);

    for (const arg of args) {
      if (arg.includes("\0")) {
        throw new Error(`Security violation: Null byte detected in argument: '${arg}'`);
      }
    }

    return spawn(binaryPath, args as string[], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
}
