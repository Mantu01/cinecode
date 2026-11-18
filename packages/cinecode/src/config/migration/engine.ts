import fs from "node:fs";
import path from "node:path";
import { createError, ErrorCode, isCinecodeError } from "../../errors/index.js";
import { REMOVED_CONFIG_KEYS, validateAuthoringConfig } from "../validator.js";
import { SCHEMA_VERSION } from "../zod-schema.js";

type ConfigObject = Record<string, any>;

export interface MigrationStepResult {
  fromVersion: number;
  toVersion: number;
  changes: string[];
}

export interface ConfigDiffEntry {
  key: string;
  action: "added" | "removed" | "modified" | "moved";
  from?: unknown;
  to?: unknown;
  description: string;
}

export interface MigrationResult {
  originalVersion: number;
  targetVersion: number;
  backupPath: string;
  appliedSteps: MigrationStepResult[];
  diff: ConfigDiffEntry[];
  newContent: string;
  modified: boolean;
}

export interface MigrationRule {
  fromVersion: number;
  toVersion: number;
  description: string;
  transform: (config: ConfigObject) => string[];
}

export interface MigrateOptions {
  readonly dryRun?: boolean;
  readonly backup?: boolean;
}

interface Token {
  type:
    | "braceOpen"
    | "braceClose"
    | "bracketOpen"
    | "bracketClose"
    | "colon"
    | "comma"
    | "parenOpen"
    | "parenClose"
    | "semicolon"
    | "dot"
    | "assign"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "identifier"
    | "comment";
  value: any;
  raw: string;
  line: number;
  col: number;
}

function tokenize(source: string, absPath: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let col = 1;

  function advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (source[index + i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    index += count;
  }

  while (index < source.length) {
    const ch = source[index]!;

    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }

    if (ch === "/" && source[index + 1] === "/") {
      const startLine = line;
      const startCol = col;
      let raw = "";
      while (index < source.length && source[index] !== "\n") {
        raw += source[index];
        advance(1);
      }
      tokens.push({ type: "comment", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    if (ch === "/" && source[index + 1] === "*") {
      const startLine = line;
      const startCol = col;
      let raw = "";
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        raw += source[index];
        advance(1);
      }
      if (index < source.length) {
        raw += "*/";
        advance(2);
      }
      tokens.push({ type: "comment", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    if (ch === "{") { tokens.push({ type: "braceOpen", value: "{", raw: "{", line, col }); advance(1); continue; }
    if (ch === "}") { tokens.push({ type: "braceClose", value: "}", raw: "}", line, col }); advance(1); continue; }
    if (ch === "[") { tokens.push({ type: "bracketOpen", value: "[", raw: "[", line, col }); advance(1); continue; }
    if (ch === "]") { tokens.push({ type: "bracketClose", value: "]", raw: "]", line, col }); advance(1); continue; }
    if (ch === ":") { tokens.push({ type: "colon", value: ":", raw: ":", line, col }); advance(1); continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: ",", raw: ",", line, col }); advance(1); continue; }
    if (ch === "(") { tokens.push({ type: "parenOpen", value: "(", raw: "(", line, col }); advance(1); continue; }
    if (ch === ")") { tokens.push({ type: "parenClose", value: ")", raw: ")", line, col }); advance(1); continue; }
    if (ch === ";") { tokens.push({ type: "semicolon", value: ";", raw: ";", line, col }); advance(1); continue; }
    if (ch === ".") { tokens.push({ type: "dot", value: ".", raw: ".", line, col }); advance(1); continue; }
    if (ch === "=") { tokens.push({ type: "assign", value: "=", raw: "=", line, col }); advance(1); continue; }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const startLine = line;
      const startCol = col;
      let val = "";
      let raw = quote;
      advance(1);
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          raw += source[index];
          advance(1);
          if (index < source.length) {
            const esc = source[index]!;
            raw += esc;
            if (esc === "n") val += "\n";
            else if (esc === "t") val += "\t";
            else if (esc === "r") val += "\r";
            else if (esc === "\\") val += "\\";
            else if (esc === quote) val += quote;
            else val += esc;
            advance(1);
          }
        } else if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
          throw createError(
            ErrorCode.CC1006,
            { path: absPath, reason: "Template literals with expressions cannot be safely migrated automatically" },
            { location: { file: absPath, line: startLine, column: startCol } },
          );
        } else {
          raw += source[index];
          val += source[index];
          advance(1);
        }
      }
      if (index >= source.length) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: "Unterminated string literal in configuration" },
          { location: { file: absPath, line: startLine, column: startCol } },
        );
      }
      raw += quote;
      advance(1);
      tokens.push({ type: "string", value: val, raw, line: startLine, col: startCol });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[index + 1] || ""))) {
      const startLine = line;
      const startCol = col;
      let raw = ch;
      advance(1);
      while (index < source.length && /[0-9.eE+-]/.test(source[index]!)) {
        const next = source[index]!;
        if ((next === "+" || next === "-") && !/[eE]/.test(raw[raw.length - 1]!)) break;
        raw += next;
        advance(1);
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Invalid number literal: ${raw}` },
          { location: { file: absPath, line: startLine, column: startCol } },
        );
      }
      tokens.push({ type: "number", value: num, raw, line: startLine, col: startCol });
      continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let raw = "";
      while (index < source.length && /[a-zA-Z0-9_$]/.test(source[index]!)) {
        raw += source[index];
        advance(1);
      }
      if (raw === "true") tokens.push({ type: "boolean", value: true, raw, line: startLine, col: startCol });
      else if (raw === "false") tokens.push({ type: "boolean", value: false, raw, line: startLine, col: startCol });
      else if (raw === "null") tokens.push({ type: "null", value: null, raw, line: startLine, col: startCol });
      else tokens.push({ type: "identifier", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Unexpected character '${ch}'` },
      { location: { file: absPath, line, column: col } },
    );
  }

  return tokens;
}

function parseCodeConfigSafe(source: string, absPath: string): ConfigObject {
  const tokens = tokenize(source, absPath);
  let cursor = 0;

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") {
    cursor++;
  }

  while (cursor < tokens.length && tokens[cursor]!.type === "identifier" && tokens[cursor]!.value === "import") {
    cursor++;
    let specifier: string | null = null;
    while (cursor < tokens.length && tokens[cursor]!.type !== "semicolon") {
      if (tokens[cursor]!.type === "identifier" && tokens[cursor]!.value === "from") {
        cursor++;
        if (cursor < tokens.length && tokens[cursor]!.type === "string") {
          specifier = tokens[cursor]!.value;
          cursor++;
        }
        break;
      }
      cursor++;
    }
    if (cursor < tokens.length && tokens[cursor]!.type === "semicolon") {
      cursor++;
    }
    if (specifier !== "cinecode") {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: `Custom import from "${specifier}" cannot be safely migrated. Please update your configuration manually.`,
        },
        { location: { file: absPath } },
      );
    }
  }

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") {
    cursor++;
  }

  if (cursor < tokens.length && tokens[cursor]!.type === "identifier") {
    const val = tokens[cursor]!.value;
    if (["const", "let", "var", "function", "class", "type", "interface"].includes(val)) {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: `Custom declaration "${val}" cannot be safely migrated. Please update your configuration manually.`,
        },
        { location: { file: absPath } },
      );
    }
  }

  let isDefineConfig = false;
  if (
    tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "export" &&
    tokens[cursor + 1]?.type === "identifier" && tokens[cursor + 1]!.value === "default"
  ) {
    cursor += 2;
  } else if (
    tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "module" &&
    tokens[cursor + 1]?.type === "dot" &&
    tokens[cursor + 2]?.type === "identifier" && tokens[cursor + 2]!.value === "exports" &&
    tokens[cursor + 3]?.type === "assign"
  ) {
    cursor += 4;
  }

  if (tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "defineConfig") {
    isDefineConfig = true;
    cursor++;
    if (tokens[cursor]?.type !== "parenOpen") {
      throw createError(
        ErrorCode.CC1006,
        { path: absPath, reason: "Expected '(' after defineConfig" },
        { location: { file: absPath } },
      );
    }
    cursor++;
  } else if (tokens[cursor]?.type === "parenOpen") {
    cursor++;
  }

  if (tokens[cursor]?.type !== "braceOpen") {
    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Expected '{' starting config object, found ${tokens[cursor]?.value ?? "EOF"}` },
      { location: { file: absPath } },
    );
  }

  let braceDepth = 0;
  for (let i = cursor; i < tokens.length; i++) {
    if (tokens[i]!.type === "braceOpen") braceDepth++;
    if (tokens[i]!.type === "braceClose") {
      braceDepth--;
      if (braceDepth === 0) break;
    }
    if (tokens[i]!.type === "comment") {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: "Configuration contains comments that cannot be preserved during automatic migration. Please update manually.",
        },
        { location: { file: absPath } },
      );
    }
  }

  function parseValue(): any {
    const tok = tokens[cursor];
    if (!tok) {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Unexpected end of input" }, { location: { file: absPath } });
    }
    if (tok.type === "string" || tok.type === "number" || tok.type === "boolean" || tok.type === "null") {
      cursor++;
      return tok.value;
    }
    if (tok.type === "braceOpen") return parseObject();
    if (tok.type === "bracketOpen") return parseArray();
    throw createError(
      ErrorCode.CC1006,
      {
        path: absPath,
        reason: `Unexpected token "${tok.value}" in config value. Computed values or variables cannot be safely migrated.`,
      },
      { location: { file: absPath, line: tok.line, column: tok.col } },
    );
  }

  function parseObject(): ConfigObject {
    if (tokens[cursor]?.type !== "braceOpen") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '{'" }, { location: { file: absPath } });
    }
    cursor++;
    const obj: ConfigObject = {};

    while (cursor < tokens.length && tokens[cursor]!.type !== "braceClose") {
      if (tokens[cursor]!.type === "comma") {
        cursor++;
        continue;
      }
      const keyTok = tokens[cursor]!;
      if (keyTok.type !== "identifier" && keyTok.type !== "string") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected identifier or string key, found "${keyTok.value}"` },
          { location: { file: absPath, line: keyTok.line, column: keyTok.col } },
        );
      }
      const key = String(keyTok.value);
      cursor++;

      if (tokens[cursor]?.type !== "colon") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ':' after key "${key}", found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
      cursor++;

      obj[key] = parseValue();

      if (tokens[cursor]?.type === "comma") {
        cursor++;
      } else if (tokens[cursor]?.type !== "braceClose") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ',' or '}' after value for "${key}", found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
    }

    if (tokens[cursor]?.type !== "braceClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '}'" }, { location: { file: absPath } });
    }
    cursor++;
    return obj;
  }

  function parseArray(): any[] {
    if (tokens[cursor]?.type !== "bracketOpen") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '['" }, { location: { file: absPath } });
    }
    cursor++;
    const arr: any[] = [];

    while (cursor < tokens.length && tokens[cursor]!.type !== "bracketClose") {
      if (tokens[cursor]!.type === "comma") {
        cursor++;
        continue;
      }
      arr.push(parseValue());
      if (tokens[cursor]?.type === "comma") {
        cursor++;
      } else if (tokens[cursor]?.type !== "bracketClose") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ',' or ']' in array, found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
    }

    if (tokens[cursor]?.type !== "bracketClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected ']'" }, { location: { file: absPath } });
    }
    cursor++;
    return arr;
  }

  const result = parseObject();

  if (isDefineConfig) {
    if (tokens[cursor]?.type !== "parenClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected ')' after defineConfig" }, { location: { file: absPath } });
    }
    cursor++;
  }

  if (tokens[cursor]?.type === "semicolon") {
    cursor++;
  }

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") {
    cursor++;
  }

  if (cursor < tokens.length) {
    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Unexpected trailing content: "${tokens[cursor]!.value}"` },
      { location: { file: absPath } },
    );
  }

  return result;
}

function deleteNestedKey(obj: ConfigObject, keyPath: string): boolean {
  const parts = keyPath.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== "object") return false;
    cur = cur[parts[i]!];
  }
  if (!cur || typeof cur !== "object") return false;
  const leaf = parts[parts.length - 1]!;
  if (leaf in cur) {
    delete cur[leaf];
    return true;
  }
  return false;
}

function migrateV1ToV2Transform(config: ConfigObject): string[] {
  const changes: string[] = [];

  if (config.fps !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.fps === undefined) config.video.fps = config.fps;
    delete config.fps;
    changes.push("Moved top-level 'fps' to 'video.fps'");
  }
  if (config.width !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.width === undefined) config.video.width = config.width;
    delete config.width;
    changes.push("Moved top-level 'width' to 'video.width'");
  }
  if (config.height !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.height === undefined) config.video.height = config.height;
    delete config.height;
    changes.push("Moved top-level 'height' to 'video.height'");
  }
  if (config.duration !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.defaultDuration === undefined) config.video.defaultDuration = config.duration;
    delete config.duration;
    changes.push("Moved top-level 'duration' to 'video.defaultDuration'");
  }
  if (config.defaultDuration !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.defaultDuration === undefined) config.video.defaultDuration = config.defaultDuration;
    delete config.defaultDuration;
    changes.push("Moved top-level 'defaultDuration' to 'video.defaultDuration'");
  }
  if (config.background !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.background === undefined) config.video.background = config.background;
    delete config.background;
    changes.push("Moved top-level 'background' to 'video.background'");
  }
  if (config.render?.background !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.background === undefined) config.video.background = config.render.background;
    delete config.render.background;
    if (Object.keys(config.render).length === 0) delete config.render;
    changes.push("Moved 'render.background' to 'video.background'");
  }
  if (config.entry !== undefined) {
    if (!config.project) config.project = {};
    if (config.project.entry === undefined) config.project.entry = config.entry;
    delete config.entry;
    changes.push("Moved top-level 'entry' to 'project.entry'");
  }
  if (config.render?.quality === "high") {
    config.render.quality = "final";
    changes.push("Upgraded deprecated render.quality 'high' to 'final'");
  }

  for (const removedKey of Object.keys(REMOVED_CONFIG_KEYS)) {
    if (deleteNestedKey(config, removedKey)) {
      changes.push(`Removed deprecated key '${removedKey}'`);
    }
  }

  return changes;
}

export const MIGRATION_RULES: readonly MigrationRule[] = [
  {
    fromVersion: 1,
    toVersion: SCHEMA_VERSION,
    description: "Move legacy fields into video/project sections and normalize options",
    transform: migrateV1ToV2Transform,
  },
];

function flattenPaths(obj: ConfigObject, prefix = ""): Map<string, any> {
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const sub = flattenPaths(v, full);
      for (const [sk, sv] of sub.entries()) {
        map.set(sk, sv);
      }
    } else {
      map.set(full, v);
    }
  }
  return map;
}

export function computeConfigDiff(original: ConfigObject, transformed: ConfigObject): ConfigDiffEntry[] {
  const diff: ConfigDiffEntry[] = [];
  const origPaths = flattenPaths(original);
  const transPaths = flattenPaths(transformed);

  for (const [key, origVal] of origPaths.entries()) {
    if (!transPaths.has(key)) {
      // Check if value moved to another key
      let movedTo: string | null = null;
      for (const [tKey, tVal] of transPaths.entries()) {
        if (!origPaths.has(tKey) && JSON.stringify(tVal) === JSON.stringify(origVal)) {
          movedTo = tKey;
          break;
        }
      }
      if (movedTo) {
        diff.push({ key, action: "moved", from: origVal, to: transPaths.get(movedTo), description: `Moved '${key}' to '${movedTo}'` });
      } else {
        diff.push({ key, action: "removed", from: origVal, description: `Removed '${key}'` });
      }
    } else {
      const transVal = transPaths.get(key);
      if (JSON.stringify(origVal) !== JSON.stringify(transVal)) {
        diff.push({
          key,
          action: "modified",
          from: origVal,
          to: transVal,
          description: `${key}: ${JSON.stringify(origVal)} -> ${JSON.stringify(transVal)}`,
        });
      }
    }
  }

  for (const [key, transVal] of transPaths.entries()) {
    if (!origPaths.has(key)) {
      const alreadyReportedMove = diff.some((entry) => entry.action === "moved" && entry.description.includes(`to '${key}'`));
      if (!alreadyReportedMove) {
        diff.push({ key, action: "added", to: transVal, description: `Added '${key}': ${JSON.stringify(transVal)}` });
      }
    }
  }

  return diff;
}

export function formatDiffSummary(diff: ConfigDiffEntry[]): string {
  if (diff.length === 0) return "No schema changes detected.";
  return diff.map((entry) => `  • ${entry.description}`).join("\n");
}

export class ConfigMigrationEngine {
  migrate(filePath: string, options: MigrateOptions = {}): MigrationResult {
    const dryRun = options.dryRun === true;
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw createError(
        ErrorCode.CC1003,
        { key: "config", path: filePath, reason: "Configuration file not found" },
        { location: { file: absPath } },
      );
    }

    const originalContent = fs.readFileSync(absPath, "utf8");
    const parsed = this.parseConfig(absPath, originalContent);

    let originalVersion: number;
    if (typeof parsed.schemaVersion === "number") {
      if (parsed.schemaVersion > SCHEMA_VERSION || parsed.schemaVersion < 1) {
        throw createError(
          ErrorCode.CC1004,
          { version: String(parsed.schemaVersion), expected: String(SCHEMA_VERSION) },
          {
            location: { file: absPath },
            fixHint: `This Cinecode release supports schema version ${SCHEMA_VERSION}; upgrade cinecode or lower schemaVersion.`,
          },
        );
      }
      originalVersion = parsed.schemaVersion;
    } else if (parsed.schemaVersion === undefined) {
      const hasV1Keys =
        parsed.fps !== undefined ||
        parsed.width !== undefined ||
        parsed.height !== undefined ||
        parsed.duration !== undefined ||
        parsed.entry !== undefined ||
        (parsed.render && parsed.render.background !== undefined);

      if (hasV1Keys && parsed.video === undefined) {
        originalVersion = 1;
      } else {
        throw createError(
          ErrorCode.CC1004,
          { version: "unknown", expected: String(SCHEMA_VERSION) },
          { location: { file: absPath }, fixHint: `Add 'schemaVersion: ${SCHEMA_VERSION}' to your configuration.` },
        );
      }
    } else {
      throw createError(
        ErrorCode.CC1004,
        { version: String(parsed.schemaVersion), expected: String(SCHEMA_VERSION) },
        { location: { file: absPath } },
      );
    }

    // Idempotent: already at current schema version
    if (originalVersion === SCHEMA_VERSION) {
      return {
        originalVersion,
        targetVersion: originalVersion,
        backupPath: "",
        appliedSteps: [],
        diff: [],
        newContent: originalContent,
        modified: false,
      };
    }

    const transformed: ConfigObject = JSON.parse(JSON.stringify(parsed));
    let currentVersion = originalVersion;
    const appliedSteps: MigrationStepResult[] = [];

    while (currentVersion < SCHEMA_VERSION) {
      const rule = MIGRATION_RULES.find((candidate) => candidate.fromVersion === currentVersion);
      if (!rule) {
        throw createError(
          ErrorCode.CC1004,
          { version: String(currentVersion), expected: String(SCHEMA_VERSION) },
          { location: { file: absPath }, fixHint: `No migration rule available from v${currentVersion} to v${SCHEMA_VERSION}` },
        );
      }
      const changes = rule.transform(transformed);
      appliedSteps.push({ fromVersion: rule.fromVersion, toVersion: rule.toVersion, changes });
      currentVersion = rule.toVersion;
      transformed.schemaVersion = currentVersion;
    }

    // Pre-write validation
    const { errors } = validateAuthoringConfig(transformed, absPath);
    if (errors.length > 0) {
      throw errors[0];
    }

    const diff = computeConfigDiff(parsed, transformed);
    const newContent = this.serialize(absPath, transformed, originalContent);

    if (newContent === originalContent) {
      return {
        originalVersion,
        targetVersion: currentVersion,
        backupPath: "",
        appliedSteps,
        diff: [],
        newContent: originalContent,
        modified: false,
      };
    }

    let backupPath = "";
    if (!dryRun) {
      if (options.backup === true) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupPath = `${absPath}.${timestamp}.bak`;
        fs.writeFileSync(backupPath, originalContent, "utf8");
      }

      // Atomic write using staged temporary file
      const tmpPath = `${absPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        fs.writeFileSync(tmpPath, newContent, "utf8");
        fs.renameSync(tmpPath, absPath);
      } catch (err) {
        if (fs.existsSync(tmpPath)) {
          fs.rmSync(tmpPath, { force: true });
        }
        throw err;
      }
    }

    return {
      originalVersion,
      targetVersion: currentVersion,
      backupPath,
      appliedSteps,
      diff,
      newContent,
      modified: true,
    };
  }

  private parseConfig(absPath: string, originalContent: string): ConfigObject {
    if (absPath.endsWith(".json")) {
      try {
        return JSON.parse(originalContent);
      } catch (error) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: error instanceof Error ? error.message : String(error) },
          { location: { file: absPath }, cause: error },
        );
      }
    }
    return parseCodeConfigSafe(originalContent, absPath);
  }

  private serialize(absPath: string, parsed: ConfigObject, originalContent: string): string {
    if (absPath.endsWith(".json")) {
      return JSON.stringify(parsed, null, 2) + "\n";
    }
    const jsonStr = JSON.stringify(parsed, null, 2);
    const isCjs = originalContent.includes("module.exports") || originalContent.includes("require(");
    if (isCjs) {
      if (/require\(["']cinecode["']\)/.test(originalContent)) {
        return `const { defineConfig } = require("cinecode");\n\nmodule.exports = defineConfig(${jsonStr});\n`;
      }
      return `module.exports = ${jsonStr};\n`;
    }
    const hasReference = originalContent.includes("/// <reference");
    if (hasReference) {
      return `/// <reference types="cinecode" />\nimport { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
    }
    return `import { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
  }
}
