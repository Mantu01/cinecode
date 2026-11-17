import { Command, CommanderError, Option } from "commander";
import { CINECODE_VERSION } from "../version.js";
import { COMMANDS, findCommand, suggestCommand, type CommandSpec } from "./command-registry.js";
import { EXIT_CODES, ExitSignal, exitCodeForError } from "./exit-codes.js";
import { UsageError } from "./usage-error.js";
import { loadEnabledAliases, resolveAliases } from "./profiles.js";
import { formatError, isCinecodeError } from "../errors/index.js";

const LICENSE = `Cinecode is MIT licensed.

Copyright (c) Cinecode contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.`;

/** Single source for the global options every command exposes. */
const GLOBAL_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["--root <dir>", "Project root directory"],
  ["--config <path>", "Config file path"],
  ["--json", "Emit machine-readable output"],
  ["--no-color", "Disable coloured output"],
  ["--verbose", "Verbose output"],
];

const GLOBAL_VALUE_FLAGS = new Set(["--root", "--config"]);
const PASSTHROUGH_TOKENS = new Set(["help", "version", "license"]);

function longFlagOf(flags: string): string {
  return flags.split(/[ ,]+/).find((part) => part.startsWith("--"))!;
}

/** Adds the global options, the deprecated alias and the in-process exit guard. */
export function applyGlobalOptions(command: Command, spec?: Pick<CommandSpec, "props">): Command {
  for (const [flags, description] of GLOBAL_OPTIONS) {
    const long = longFlagOf(flags);
    if (!command.options.some((option) => option.long === long)) command.option(flags, description);
  }
  if (spec?.props && !command.options.some((option) => option.long === "--props")) {
    command.addOption(new Option("--props <path>", "Deprecated alias of --config").conflicts("config"));
  }
  command.exitOverride();
  for (const child of command.commands) applyGlobalOptions(child);
  return command;
}

function defaultLabel(option: Option): string {
  if (option.defaultValue !== undefined) return JSON.stringify(option.defaultValue);
  if (option.negate) return "true";
  if (option.isBoolean()) return "false";
  return "unset";
}

/** Example invocation and per-option default, generated from the definition. */
function attachHelp(command: Command, example: string): void {
  const defaults = command.options
    .map((option) => `  ${option.flags.padEnd(42)} ${defaultLabel(option)}`)
    .join("\n");
  command.addHelpText("after", `\nExample:\n  ${example}\n\nDefaults ("unset" resolves from project config or the command fallback):\n${defaults}`);
}

function describeCommand(command: Command, spec: CommandSpec): Command {
  applyGlobalOptions(command, spec);
  attachHelp(command, spec.example);
  return command;
}

function registerStubs(program: Command): void {
  const existing = new Set(program.commands.map((command) => command.name()));
  for (const spec of COMMANDS) {
    if (existing.has(spec.name)) continue;
    const command = program.command(spec.name).description(spec.summary).allowUnknownOption().allowExcessArguments();
    describeCommand(command, spec);
  }
}

function commandIndex(args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") return -1;
    if (GLOBAL_VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return index;
  }
  return -1;
}

function takeGlobalOption(args: readonly string[], index: number): string[] | undefined {
  const arg = args[index]!;
  if (GLOBAL_VALUE_FLAGS.has(arg)) {
    const value = args[index + 1];
    return value === undefined ? [arg] : [arg, value];
  }
  if (arg === "--json" || arg === "--no-color" || arg === "--verbose") return [arg];
  if (arg.startsWith("--root=") || arg.startsWith("--config=")) return [arg];
  return undefined;
}

/** Moves global options behind the command token so the command sees them. */
function hoistGlobalOptions(args: readonly string[], tokenIndex: number): string[] {
  const globals: string[] = [];
  const rest: string[] = [];
  let insertion = 0;
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === "--") {
      rest.push(...args.slice(index));
      break;
    }
    const taken = takeGlobalOption(args, index);
    if (taken) {
      globals.push(...taken);
      index += taken.length;
      continue;
    }
    const isToken = index === tokenIndex;
    rest.push(arg);
    if (isToken) insertion = arg === "help" ? rest.length - 1 : rest.length;
    index += 1;
  }
  if (tokenIndex < 0) return [...rest, ...globals];
  return [...rest.slice(0, insertion), ...globals, ...rest.slice(insertion)];
}

function reportError(error: unknown, verbose: boolean, color: boolean): number {
  if (error instanceof ExitSignal) return error.exitCode;
  if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT_CODES.success : EXIT_CODES.usage;
  if (error instanceof UsageError) {
    console.error(error.message);
    return EXIT_CODES.usage;
  }
  if (isCinecodeError(error)) {
    console.error(formatError(error, verbose, color));
    return exitCodeForError(error.code);
  }
  console.error(error instanceof Error ? error.message : String(error));
  return EXIT_CODES.runtime;
}

export interface RunCliOptions {
  readonly cwd?: string;
  /** Commander help/version/error writers; defaults to the process streams. */
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

function configureRunOutput(command: Command, options: RunCliOptions): void {
  if (!options.stdout && !options.stderr) return;
  const output = {
    writeOut: options.stdout ?? ((text: string) => void process.stdout.write(text)),
    writeErr: options.stderr ?? ((text: string) => void process.stderr.write(text)),
  };
  const apply = (target: Command): void => {
    target.configureOutput(output);
    for (const child of target.commands) apply(child);
  };
  apply(command);
}

/**
 * Constructs a fresh program and runs one argument list. Parsing, home-state
 * reads, colour and verbose decisions all happen here, never at import.
 */
export async function runCli(argv: readonly string[] = process.argv, options: RunCliOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const raw = argv.slice(2);
  const program = createProgram();
  const noColor = raw.includes("--no-color");
  const previousNoColor = process.env.NO_COLOR;
  let jsonMode = false;
  let args = [...raw];
  let applied: readonly string[] = [];

  if (noColor) process.env.NO_COLOR = "1";

  try {
    const entryIndex = commandIndex(raw);
    const entryToken = entryIndex >= 0 ? raw[entryIndex] : undefined;
    if (entryToken && !PASSTHROUGH_TOKENS.has(entryToken)) {
      const resolution = resolveAliases(
        raw,
        loadEnabledAliases(cwd),
        (name) => findCommand(name) !== undefined || PASSTHROUGH_TOKENS.has(name),
        entryIndex,
      );
      args = resolution.args;
      applied = resolution.applied;
      const index = commandIndex(args);
      const token = index >= 0 ? args[index] : undefined;
      if (applied.length > 0 && (!token || (!findCommand(token) && !PASSTHROUGH_TOKENS.has(token)))) {
        const suggestion = token ? suggestCommand(token) : undefined;
        throw new UsageError(
          `Alias ${applied.join(", ")} does not resolve to a known command${suggestion ? `; did you mean ${suggestion}?` : "."}`,
        );
      }
    }

    const tokenIndex = commandIndex(args);
    const token = tokenIndex >= 0 ? args[tokenIndex] : undefined;
    const spec = token ? findCommand(token) : undefined;
    if (spec?.props && args.includes("--props")) {
      console.error("cinecode: --props is deprecated, use --config instead.");
    }

    if (spec) {
      program.addCommand(describeCommand(await spec.load(), spec));
    } else if (token === "help") {
      const target = args[1] ? findCommand(args[1]) : undefined;
      if (target) program.addCommand(describeCommand(await target.load(), target));
      else registerStubs(program);
    } else {
      registerStubs(program);
    }

    configureRunOutput(program, options);

    program.hook("preAction", async (_thisCommand, actionCommand) => {
      const opts = actionCommand.opts();
      if (applied.length > 0 && opts.verbose === true) console.error(`cinecode: alias ${applied.join(", ")}`);
      if (opts.json === true) {
        const { setJsonMode } = await import("../observability/logger.js");
        setJsonMode(true);
        jsonMode = true;
      }
    });

    await program.parseAsync(["node", "cinecode", ...hoistGlobalOptions(args, tokenIndex)]);
    return EXIT_CODES.success;
  } catch (error) {
    const verbose = program.opts().verbose === true || args.includes("--verbose");
    return reportError(error, verbose, !noColor);
  } finally {
    if (jsonMode) {
      const { setJsonMode } = await import("../observability/logger.js");
      setJsonMode(false);
    }
    if (noColor) {
      if (previousNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previousNoColor;
    }
  }
}

export function createProgram(): Command {
  const program = new Command()
    .name("cinecode")
    .description("Code-first 2D animation engine and video generation framework")
    .version(CINECODE_VERSION)
    .allowExcessArguments(false)
    .enablePositionalOptions()
    .showSuggestionAfterError(true)
    .exitOverride();

  applyGlobalOptions(program);

  const version = program
    .command("version")
    .description("Show the Cinecode version")
    .action(() => console.log(CINECODE_VERSION));
  const license = program
    .command("license")
    .description("Show license information")
    .action(() => console.log(LICENSE));

  for (const command of [version, license]) {
    applyGlobalOptions(command);
    attachHelp(command, `cinecode ${command.name()}`);
  }

  return program;
}
