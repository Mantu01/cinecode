import { readFileSync, writeFileSync, constants, access } from "node:fs";
import { resolve } from "node:path";

const CINECODE_BLOCK_START = "# Cinecode";
const CINECODE_BLOCK_END = "# End Cinecode";

function normalizeEntry(entry: string): string {
  return entry.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\\/g, "/");
}

function entriesMatch(a: string, b: string): boolean {
  return normalizeEntry(a) === normalizeEntry(b);
}

function isInCinecodeBlock(lines: string[], index: number): boolean {
  let inBlock = false;
  for (let i = 0; i <= index; i++) {
    if (lines[i]?.trim() === CINECODE_BLOCK_START) inBlock = true;
    if (lines[i]?.trim() === CINECODE_BLOCK_END) inBlock = false;
  }
  return inBlock;
}

export interface GitignoreManagerOptions {
  readonly sourceDir?: string;
  readonly mediaDir?: string;
  readonly outputDir: string;
  readonly cacheDir: string;
  readonly projectRoot: string;
  readonly enabled: boolean;
  readonly ignoreMedia?: boolean;
}

export async function ensureGitignoreEntries(options: GitignoreManagerOptions): Promise<string[]> {
  if (!options.enabled) return [];

  const gitignorePath = resolve(options.projectRoot, ".gitignore");
  let content = "";
  let existingLines: string[];

  try {
    await new Promise<void>((resolvePromise, reject) => {
      access(gitignorePath, constants.R_OK, err => {
        if (err) reject(err);
        else resolvePromise();
      });
    });
    content = readFileSync(gitignorePath, "utf-8");
    existingLines = content.split(/\r?\n/);
  } catch {
    existingLines = [];
  }

  const entries = [normalizeEntry(options.outputDir), normalizeEntry(options.cacheDir)];
  if (options.ignoreMedia && options.mediaDir) {
    entries.push(normalizeEntry(options.mediaDir));
  }
  const forbidden = options.sourceDir ? normalizeEntry(options.sourceDir) : "";
  const requiredEntries = entries.filter(e => Boolean(e) && e !== forbidden);

  const newLines = [...existingLines];
  let blockStartIndex = -1;
  let blockEndIndex = -1;

  for (let i = 0; i < newLines.length; i++) {
    if (newLines[i]?.trim() === CINECODE_BLOCK_START) blockStartIndex = i;
    if (newLines[i]?.trim() === CINECODE_BLOCK_END) blockEndIndex = i;
  }

  const existingInBlock = new Set<string>();
  if (blockStartIndex !== -1 && blockEndIndex !== -1 && blockEndIndex > blockStartIndex) {
    for (let i = blockStartIndex + 1; i < blockEndIndex; i++) {
      const line = newLines[i]?.trim();
      if (line && !line.startsWith("#")) {
        existingInBlock.add(normalizeEntry(line));
      }
    }
  }

  const entriesToAdd = requiredEntries.filter(e => !existingInBlock.has(normalizeEntry(e)));

  if (entriesToAdd.length === 0) return [];

  if (blockStartIndex === -1) {
    if (newLines.length > 0 && newLines[newLines.length - 1] !== "") {
      newLines.push("");
    }
    newLines.push(CINECODE_BLOCK_START);
    for (const entry of entriesToAdd) {
      newLines.push(entry);
    }
    newLines.push(CINECODE_BLOCK_END);
  } else {
    for (const entry of entriesToAdd) {
      newLines.splice(blockEndIndex, 0, entry);
      blockEndIndex++;
    }
  }

  const finalContent = newLines.join("\n");
  if (finalContent !== content) {
    writeFileSync(gitignorePath, finalContent, "utf-8");
  }
  return entriesToAdd;
}

export async function removeGitignoreEntries(options: GitignoreManagerOptions): Promise<void> {
  if (!options.enabled) return;

  const gitignorePath = resolve(options.projectRoot, ".gitignore");

  try {
    await new Promise<void>((resolvePromise, reject) => {
      access(gitignorePath, constants.R_OK, err => {
        if (err) reject(err);
        else resolvePromise();
      });
    });
  } catch {
    return;
  }

  const content = readFileSync(gitignorePath, "utf-8");
  const lines = content.split(/\r?\n/);

  const entries = [normalizeEntry(options.outputDir), normalizeEntry(options.cacheDir)];
  if (options.ignoreMedia && options.mediaDir) {
    entries.push(normalizeEntry(options.mediaDir));
  }
  const forbidden = options.sourceDir ? normalizeEntry(options.sourceDir) : "";
  const requiredEntries = new Set(entries.filter(e => Boolean(e) && e !== forbidden));

  const newLines = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    if (isInCinecodeBlock(lines, index)) {
      return !requiredEntries.has(normalizeEntry(trimmed));
    }
    return true;
  });

  const blockStart = newLines.findIndex(l => l.trim() === CINECODE_BLOCK_START);
  const blockEnd = newLines.findIndex(l => l.trim() === CINECODE_BLOCK_END);

  if (blockStart !== -1 && blockEnd !== -1) {
    let hasContent = false;
    for (let i = blockStart + 1; i < blockEnd; i++) {
      const trimmed = newLines[i]?.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      newLines.splice(blockStart, blockEnd - blockStart + 1);
    }
  }

  const finalContent = newLines.join("\n");
  if (finalContent !== content) {
    writeFileSync(gitignorePath, finalContent, "utf-8");
  }
}

export async function checkGitignoreEntries(options: GitignoreManagerOptions): Promise<{ missing: string[]; present: string[] }> {
  if (!options.enabled) return { missing: [], present: [] };

  const gitignorePath = resolve(options.projectRoot, ".gitignore");
  let existingLines: string[];

  try {
    await new Promise<void>((resolvePromise, reject) => {
      access(gitignorePath, constants.R_OK, err => {
        if (err) reject(err);
        else resolvePromise();
      });
    });
    const content = readFileSync(gitignorePath, "utf-8");
    existingLines = content.split(/\r?\n/);
  } catch {
    existingLines = [];
  }

  const entries = [normalizeEntry(options.outputDir), normalizeEntry(options.cacheDir)];
  if (options.ignoreMedia && options.mediaDir) {
    entries.push(normalizeEntry(options.mediaDir));
  }
  const forbidden = options.sourceDir ? normalizeEntry(options.sourceDir) : "";
  const requiredEntries = entries.filter(e => Boolean(e) && e !== forbidden);

  const present: string[] = [];
  const missing: string[] = [];

  for (const entry of requiredEntries) {
    let found = false;
    for (const line of existingLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (entriesMatch(trimmed, entry)) {
        found = true;
        break;
      }
    }
    if (found) present.push(entry);
    else missing.push(entry);
  }

  return { missing, present };
}