import path from "node:path";
import { createError, ErrorCode } from "../../errors/index.js";
import { UsageError } from "../shared/usage-error.js";
import type { CommandOptionSpec, CommandSpec } from "../registry/types.js";

export interface GlobalCliOptions {
  root?: string;
  config?: string;
  json: boolean;
  noColor: boolean;
  verbose: boolean;
  quiet: boolean;
  all: boolean;
  help: boolean;
  version: boolean;
}

export interface PreParsedResult {
  readonly globalOptions: GlobalCliOptions;
  readonly commandToken?: string;
  readonly commandArgs: readonly string[];
  readonly rawGlobals: ReadonlyMap<string, string | boolean>;
}

export const GLOBAL_FLAGS = new Set([
  "--root",
  "--config",
  "--json",
  "--no-color",
  "--verbose",
  "--quiet",
  "-v",
  "--all",
  "--help",
  "-h",
  "--version",
  "-V",
]);

import { parseMemoryBudgetMb as parseRawMemoryBudgetMb } from "../../config/defaults.js";

/** Parse memory budget string into megabytes (e.g. "1GB" -> 1024, "512MB" -> 512). */
export function parseMemoryBudgetMb(value: unknown): number {
  try {
    return parseRawMemoryBudgetMb(value);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw createError(ErrorCode.CC0001, { reason }, { fixHint: "Provide memory budget >= 16MB like '1GB' or '512MB'." });
  }
}

/** Pre-parser separating global flags, command token, and command arguments. */
export function preParseArgs(
  rawArgs: readonly string[],
  isKnownCommand: (token: string) => boolean,
): PreParsedResult {
  const globalOptions: GlobalCliOptions = {
    json: false,
    noColor: false,
    verbose: false,
    quiet: false,
    all: false,
    help: false,
    version: false,
  };
  const rawGlobals = new Map<string, string | boolean>();
  let commandToken: string | undefined;
  const commandArgs: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;

    // '--' terminates option parsing: everything remaining is literal command args
    if (arg === "--") {
      commandArgs.push(...rawArgs.slice(i));
      break;
    }

    // Equals form: e.g. --root=/path or --config=./cinecode.config.ts
    if (arg.startsWith("--root=")) {
      const val = arg.slice("--root=".length);
      globalOptions.root = val;
      rawGlobals.set("--root", val);
      i++;
      continue;
    }
    if (arg === "--root") {
      const next = rawArgs[i + 1];
      if (next === undefined || next === "--" || next.startsWith("-")) {
        throw new UsageError("error: option '--root' argument missing");
      }
      globalOptions.root = next;
      rawGlobals.set("--root", next);
      i += 2;
      continue;
    }

    if (arg.startsWith("--config=")) {
      const val = arg.slice("--config=".length);
      globalOptions.config = val;
      rawGlobals.set("--config", val);
      i++;
      continue;
    }
    if (arg === "--config") {
      const next = rawArgs[i + 1];
      if (next === undefined || next === "--" || next.startsWith("-")) {
        throw new UsageError("error: option '--config' argument missing");
      }
      globalOptions.config = next;
      rawGlobals.set("--config", next);
      i += 2;
      continue;
    }

    // Boolean flags: never consume next value
    if (arg === "--json" || arg === "--json=true") {
      globalOptions.json = true;
      rawGlobals.set("--json", true);
      i++;
      continue;
    }
    if (arg === "--json=false") {
      globalOptions.json = false;
      rawGlobals.set("--json", false);
      i++;
      continue;
    }

    if (arg === "--no-color") {
      globalOptions.noColor = true;
      rawGlobals.set("--no-color", true);
      i++;
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      globalOptions.verbose = true;
      rawGlobals.set("--verbose", true);
      i++;
      continue;
    }

    if (arg === "--quiet" || arg === "--quiet=true") {
      globalOptions.quiet = true;
      rawGlobals.set("--quiet", true);
      i++;
      continue;
    }
    if (arg === "--quiet=false") {
      globalOptions.quiet = false;
      rawGlobals.set("--quiet", false);
      i++;
      continue;
    }

    if (arg === "--all") {
      globalOptions.all = true;
      rawGlobals.set("--all", true);
      i++;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      globalOptions.help = true;
      rawGlobals.set("--help", true);
      i++;
      continue;
    }

    if (arg === "--version" || arg === "-V") {
      globalOptions.version = true;
      rawGlobals.set("--version", true);
      i++;
      continue;
    }

    // If it starts with - and is not a global flag
    if (arg.startsWith("-")) {
      if (commandToken === undefined) {
        // Unknown flag before command token
        throw new UsageError(`error: unknown option '${arg}'`);
      }
      // Belongs to the command
      commandArgs.push(arg);
      i++;
      continue;
    }

    // Positional argument
    if (commandToken === undefined) {
      if (isKnownCommand(arg)) {
        commandToken = arg;
      } else {
        // Bare positional or unknown command
        commandToken = arg;
      }
    } else {
      // Bare positional after command token
      commandArgs.push(arg);
    }
    i++;
  }

  return {
    globalOptions,
    commandToken,
    commandArgs,
    rawGlobals,
  };
}

/** Validate bounds on a numeric option. */
export function validateNumericBounds(opt: CommandOptionSpec, value: unknown): number {
  if (value === undefined || value === null) {
    if (opt.default !== undefined) return opt.default as number;
    return undefined as unknown as number;
  }
  let num: number;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw createError(
        ErrorCode.CC0001,
        { reason: `error: option '${opt.flags}' argument '${value}' is invalid number` },
        { fixHint: `Provide a valid number for '${opt.name}'.` },
      );
    }
    num = Number(trimmed);
  } else {
    throw createError(
      ErrorCode.CC0001,
      { reason: `error: option '${opt.flags}' argument is invalid` },
      { fixHint: `Provide a valid number for '${opt.name}'.` },
    );
  }

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw createError(
      ErrorCode.CC0001,
      { reason: `error: option '${opt.flags}' argument '${value}' is invalid number` },
      { fixHint: `Provide a valid number for '${opt.name}'.` },
    );
  }

  if (opt.bounds?.min !== undefined && num < opt.bounds.min) {
    throw createError(
      ErrorCode.CC0001,
      { reason: `error: option '${opt.flags}' argument '${num}' is below minimum ${opt.bounds.min}` },
      { fixHint: `Provide a value >= ${opt.bounds.min} for '${opt.name}'.` },
    );
  }

  if (opt.bounds?.max !== undefined && num > opt.bounds.max) {
    throw createError(
      ErrorCode.CC0001,
      { reason: `error: option '${opt.flags}' argument '${num}' exceeds maximum ${opt.bounds.max}` },
      { fixHint: `Provide a value <= ${opt.bounds.max} for '${opt.name}'.` },
    );
  }

  return num;
}

/** Validate strict enum choices. */
export function validateEnumOption(opt: CommandOptionSpec, value: unknown): string {
  if (value === undefined || value === null) {
    return opt.default as string;
  }
  const str = String(value);
  if (!opt.choices || !opt.choices.includes(str)) {
    const allowed = opt.choices ? opt.choices.join(", ") : "none";
    throw createError(
      ErrorCode.CC0001,
      { reason: `error: option '${opt.flags}' argument '${value}' is invalid. Allowed choices: ${allowed}` },
      { fixHint: `Choose one of: ${allowed}` },
    );
  }
  return str;
}

/** Validate all command options against spec: types, bounds, enums, paths, conflicts, requires. */
export function validateCommandOptions(
  spec: CommandSpec,
  options: Record<string, unknown>,
  baseDir = process.cwd(),
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...options };

  for (const opt of spec.options) {
    const val = result[opt.name];
    if (val !== undefined && val !== null) {
      // Conflicts check
      if (opt.conflicts && opt.conflicts.length > 0) {
        for (const conflict of opt.conflicts) {
          if (result[conflict] !== undefined && result[conflict] !== null && result[conflict] !== false) {
            throw createError(
              ErrorCode.CC0001,
              { reason: `error: option '--${opt.name}' cannot be used with option '--${conflict}'` },
              { fixHint: `Use either '--${opt.name}' or '--${conflict}', not both.` },
            );
          }
        }
      }

      // Requires check
      if (opt.requires && opt.requires.length > 0) {
        for (const req of opt.requires) {
          if (result[req] === undefined || result[req] === null) {
            throw createError(
              ErrorCode.CC0001,
              { reason: `error: option '--${opt.name}' requires option '--${req}'` },
              { fixHint: `Specify '--${req}' when using '--${opt.name}'.` },
            );
          }
        }
      }

      // Type checks
      if (opt.type === "number") {
        result[opt.name] = validateNumericBounds(opt, val);
      } else if (opt.type === "enum") {
        result[opt.name] = validateEnumOption(opt, val);
      } else if (opt.type === "path") {
        const rawPath = String(val);
        result[`__raw_${opt.name}`] = rawPath;
        result[opt.name] = path.resolve(baseDir, rawPath);
      }
    } else if (opt.default !== undefined) {
      // Apply default only when absent
      result[opt.name] = opt.default;
    }
  }

  // Canonical memory budget check
  if (result.memoryBudget !== undefined) {
    result.memoryBudgetMb = parseMemoryBudgetMb(result.memoryBudget);
  }

  return result;
}
