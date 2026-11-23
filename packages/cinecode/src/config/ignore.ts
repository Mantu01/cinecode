import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface IgnoreRule {
  readonly pattern: string;
  readonly isNegation: boolean;
  readonly lineNumber: number;
  readonly directoryOnly: boolean;
}

export interface CinecodeIgnoreOptions {
  readonly patterns?: readonly string[];
  readonly useDefaults?: boolean;
}

export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  ".DS_Store",
  "Thumbs.db",
  "coverage/**",
  "__snapshots__/**",
];

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let source = pattern.replace(/\\/g, "/").trim();
  let anchored = false;
  if (source.startsWith("/")) {
    anchored = true;
    source = source.slice(1);
  }
  if (source.startsWith("**/")) {
    anchored = false;
    source = source.slice(3);
  }
  if (!anchored && !source.includes("/")) {
    anchored = false;
  } else if (source.includes("/")) {
    anchored = true;
  }

  let regex = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "*") {
      const isDouble = source[index + 1] === "*";
      if (isDouble) {
        if (source[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 2;
        } else {
          regex += ".*";
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    if (char === "[") {
      const end = source.indexOf("]", index + 1);
      if (end !== -1) {
        regex += source.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    regex += escapeRegex(char);
  }

  const prefix = anchored ? "^" : "(?:^|.*/)";
  return new RegExp(`${prefix}${regex}(?:/.*)?$`);
}

function parseRules(content: string, startLine = 1): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const isNegation = trimmed.startsWith("!");
    const withoutNegation = isNegation ? trimmed.slice(1) : trimmed;
    if (withoutNegation.length === 0) continue;
    const directoryOnly = withoutNegation.endsWith("/");
    const pattern = directoryOnly ? withoutNegation.slice(0, -1) : withoutNegation;
    rules.push({
      pattern,
      isNegation,
      lineNumber: startLine + index,
      directoryOnly,
    });
  }
  return rules;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export class CinecodeIgnore {
  private readonly rules: readonly IgnoreRule[];
  private readonly compiled: readonly { readonly rule: IgnoreRule; readonly regex: RegExp }[];

  constructor(options: CinecodeIgnoreOptions = {}, fileRules: readonly IgnoreRule[] = []) {
    const inline = (options.patterns ?? []).flatMap((pattern, index) => parseRules(pattern, index + 1));
    const defaults = options.useDefaults === false ? [] : parseRules(DEFAULT_IGNORE_PATTERNS.join("\n"));
    this.rules = [...defaults, ...fileRules, ...inline].filter((rule) => rule.pattern.length > 0);
    this.compiled = this.rules.map((rule) => ({ rule, regex: globToRegExp(rule.pattern) }));
  }

  static fromFile(path: string, options: CinecodeIgnoreOptions = {}): CinecodeIgnore {
    const resolvedPath = resolve(path);
    if (!existsSync(resolvedPath)) return new CinecodeIgnore(options);
    const content = readFileSync(resolvedPath, "utf-8");
    return new CinecodeIgnore(options, parseRules(content));
  }

  shouldIgnore(relativePath: string): boolean {
    const normalized = normalizePath(relativePath);
    if (normalized.length === 0) return false;
    let ignored = false;
    for (const { rule, regex } of this.compiled) {
      if (regex.test(normalized)) ignored = !rule.isNegation;
    }
    return ignored;
  }

  /** The rule that decides the path, honoring later negation rules. */
  matchRule(relativePath: string): IgnoreRule | null {
    const normalized = normalizePath(relativePath);
    if (normalized.length === 0) return null;
    let matched: IgnoreRule | null = null;
    for (const { rule, regex } of this.compiled) {
      if (regex.test(normalized)) matched = rule;
    }
    return matched && !matched.isNegation ? matched : null;
  }

  getRules(): readonly IgnoreRule[] {
    return this.rules;
  }
}

export function loadCinecodeIgnore(
  projectRoot: string,
  options: CinecodeIgnoreOptions = {},
): CinecodeIgnore {
  return CinecodeIgnore.fromFile(resolve(projectRoot, ".cinecodeignore"), options);
}

export function parseIgnoreContent(content: string): readonly IgnoreRule[] {
  return parseRules(content);
}
