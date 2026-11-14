import { createHash, randomUUID } from "node:crypto";
import { chmod, chown, copyFile, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface AtomicWriteOptions {
  readonly fileMode?: number;
  readonly verifyChecksum?: boolean;
  readonly preserveOwnership?: boolean;
  readonly allowCopyFallback?: boolean;
}

export interface AtomicWriteResult {
  readonly outputPath: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly usedCopyFallback: boolean;
}

export class AtomicWriteError extends Error {
  readonly targetPath: string;
  readonly tempPath: string;

  constructor(targetPath: string, tempPath: string, message: string, options?: { cause?: unknown }) {
    super(`[CC2401] ${message}`, options);
    this.name = "AtomicWriteError";
    this.targetPath = targetPath;
    this.tempPath = tempPath;
  }
}

const activeTempFiles = new Set<string>();
const COPY_FALLBACK_ERRORS = new Set(["EXDEV", "EPERM", "ENOTSUP", "EACCES", "EINVAL", "ENOSYS"]);

export function temporaryPathFor(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`);
}

export function registerTempFile(path: string): void {
  activeTempFiles.add(path);
}

export function unregisterTempFile(path: string): void {
  activeTempFiles.delete(path);
}

export function listActiveTempFiles(): readonly string[] {
  return [...activeTempFiles];
}

export async function cleanupActiveTempFiles(): Promise<void> {
  const files = [...activeTempFiles];
  activeTempFiles.clear();
  await Promise.all(files.map((file) => rm(file, { force: true }).catch(() => undefined)));
}

async function fileChecksum(path: string): Promise<string> {
  const info = await stat(path);
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, info.size)));
    let position = 0;
    while (position < info.size) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead <= 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function applyMetadata(tempPath: string, targetPath: string, options: AtomicWriteOptions): Promise<void> {
  const mode = options.fileMode ?? 0o644;
  await chmod(tempPath, mode).catch(() => undefined);
  if (options.preserveOwnership === false) return;
  const existing = await stat(targetPath).catch(() => null);
  if (!existing) return;
  await chown(tempPath, existing.uid, existing.gid).catch(() => undefined);
}

async function copyVerifyDelete(tempPath: string, targetPath: string): Promise<string> {
  const staging = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.staged`);
  await copyFile(tempPath, staging);
  const [sourceChecksum, stagedChecksum] = await Promise.all([fileChecksum(tempPath), fileChecksum(staging)]);
  if (sourceChecksum !== stagedChecksum) {
    await rm(staging, { force: true });
    throw new AtomicWriteError(targetPath, tempPath, "Cross-volume copy verification failed; target left untouched");
  }
  await rm(targetPath, { force: true });
  await rename(staging, targetPath);
  await rm(tempPath, { force: true });
  return stagedChecksum;
}

export async function promoteTempFile(
  tempPath: string,
  targetPath: string,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  await mkdir(dirname(targetPath), { recursive: true });
  await applyMetadata(tempPath, targetPath, options);
  const checksum = options.verifyChecksum === false ? "" : await fileChecksum(tempPath);
  let usedCopyFallback = false;
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (options.allowCopyFallback === false || !COPY_FALLBACK_ERRORS.has(code)) {
      throw new AtomicWriteError(targetPath, tempPath, `Atomic rename failed: ${code || String(error)}`, { cause: error });
    }
    usedCopyFallback = true;
    await copyVerifyDelete(tempPath, targetPath).catch((fallbackError: unknown) => {
      throw new AtomicWriteError(targetPath, tempPath, "Cross-device promotion failed", { cause: fallbackError });
    });
  }
  unregisterTempFile(tempPath);
  const info = await stat(targetPath);
  return { outputPath: targetPath, checksum, sizeBytes: info.size, usedCopyFallback };
}

export async function withAtomicOutput(
  targetPath: string,
  writer: (tempPath: string) => Promise<void>,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const resolvedTarget = resolve(targetPath);
  await mkdir(dirname(resolvedTarget), { recursive: true });
  const tempPath = temporaryPathFor(resolvedTarget);
  registerTempFile(tempPath);
  try {
    await writer(tempPath);
    return await promoteTempFile(tempPath, resolvedTarget, options);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    unregisterTempFile(tempPath);
    throw error;
  }
}

export async function writeFileAtomic(
  targetPath: string,
  data: Buffer | string,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  return withAtomicOutput(targetPath, async (tempPath) => {
    await writeFile(tempPath, data);
  }, options);
}

export async function cleanupStaleTempFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(".") || !entry.name.endsWith(".tmp")) continue;
    await rm(join(directory, entry.name), { force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

export async function isSameVolume(first: string, second: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    stat(dirname(resolve(first))).catch(() => null),
    stat(dirname(resolve(second))).catch(() => null),
  ]);
  if (!left || !right) return false;
  return left.dev === right.dev;
}
