import { Command, CommanderError, Option } from "commander";
import { CINECODE_VERSION } from "../version.js";
import { COMMANDS, findCommand, suggestCommand, type CommandSpec, commandNames } from "./command-registry.js";
import { EXIT_CODES, EXIT_CODE_MEANINGS, ExitSignal, exitCodeForError } from "./exit-codes.js";
import { UsageError } from "./usage-error.js";
import { loadEnabledAliases, resolveAliases } from "./profiles.js";
import { createError, ErrorCode, formatError, isCinecodeError, type CinecodeError } from "../errors/index.js";
import { runReport, validateMachineReport, type MachineErrorRecord, type MachineReport } from "./run-report.js";
import { StdoutCapture } from "./machine-capture.js";

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
export function applyGlobalOptions(command: Command): Command {
  for (const [flags, description] of GLOBAL_OPTIONS) {
    const long = longFlagOf(flags);
    if (!command.options.some((option) => option.long === long)) command.option(flags, description);
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
  applyGlobalOptions(command);
  attachHelp(command, spec.example);
  attachListPresetsAlias(command, spec);
  return command;
}

function attachListPresetsAlias(command: Command, spec: CommandSpec): void {
  if (spec.name !== "presets") return;
  command.option("--list-presets", "list platform deliverable presets");
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

interface Failure {
  readonly exitCode: number;
  readonly error: MachineErrorRecord;
  readonly errorObject?: CinecodeError;
  readonly plainMessage?: string;
}

function isModuleError(error: unknown): error is Error & { code: string; file: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string" && "file" in error;
}

function describeFailure(error: unknown): Failure {
  if (error instanceof ExitSignal) {
    const coded = createError(error.message === "Render cancelled" ? ErrorCode.CC4003 : ErrorCode.CC9001, { reason: error.message });
    return { exitCode: error.exitCode, error: { code: coded.code, message: coded.message, fixHint: coded.fixHint }, errorObject: coded };
  }
  if (error instanceof CommanderError || error instanceof UsageError) {
    const coded = createError(ErrorCode.CC0001, { reason: error.message });
    return {
      exitCode: error instanceof CommanderError && error.exitCode === 0 ? EXIT_CODES.success : EXIT_CODES.usage,
      error: { code: coded.code, message: error.message, fixHint: coded.fixHint },
      errorObject: coded,
    };
  }
  if (isCinecodeError(error)) {
    const rawIssues = (error as { issues?: readonly CinecodeError[] }).issues;
    return {
      exitCode: exitCodeForError(error.code),
      error: {
        code: error.code,
        message: error.message,
        path: error.location?.file,
        location: error.location,
        fixHint: error.fixHint,
        cause: error.cause instanceof Error ? error.cause.message : undefined,
        issues: Array.isArray(rawIssues)
          ? rawIssues.map((issue) => ({
              code: issue.code,
              message: issue.message,
              location: issue.location,
              fixHint: issue.fixHint,
            }))
          : undefined,
      },
      errorObject: error,
    };
  }
  if (isModuleError(error)) {
    return {
      exitCode: error.code === "USER_MODULE_UNSUPPORTED_SYNTAX" ? EXIT_CODES.environment : EXIT_CODES.validation,
      error: { code: error.code, message: error.message, path: error.file, location: { file: error.file } },
    };
  }
  const reason = error instanceof Error ? error.message : String(error);
  const wrapped = createError(ErrorCode.CC9001, { reason }, { cause: error });
  return {
    exitCode: EXIT_CODES.runtime,
    error: { code: wrapped.code, message: wrapped.message, fixHint: wrapped.fixHint, cause: reason },
    errorObject: wrapped,
  };
}

/** The document is validated before it is written, exactly once per invocation. */
function writeMachine(doc: MachineReport, write: (text: string) => void): void {
  const problems = validateMachineReport(doc);
  if (problems.length > 0) throw createError(ErrorCode.CC9002, { reason: problems.join("; ") });
  write(`${JSON.stringify(doc, null, 2)}\n`);
}

function reportError(error: unknown, verbose: boolean, color: boolean, machine: boolean, write: (text: string) => void): number {
  const failure = describeFailure(error);
  if (failure.errorObject) console.error(formatError(failure.errorObject, verbose, color));
  else if (failure.plainMessage) console.error(failure.plainMessage);
  const degraded = runReport.degradationSummary();
  if (degraded) console.error(degraded);
  if (machine) writeMachine(runReport.errorReport(failure.error), write);
  return failure.exitCode;
}

/** Adds the incidental stdout to the document; the command payload always wins. */
function withCapturedOutput(report: MachineReport, capture: StdoutCapture): MachineReport {
  const payload = capture.drain();
  if (Object.keys(payload).length === 0) return report;
  return { ...report, result: { ...payload, ...report.result } };
}

/** Informational commands print text only: no envelope, no summary, no error line. */
export const INFORMATIONAL_COMMANDS = new Set(["help", "version", "license"]);

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
  const previousVerbose = process.env.CINECODE_VERBOSE;
  const machine = raw.includes("--json");
  const stdoutWrite = options.stdout ?? (process.stdout.write.bind(process.stdout) as (text: string) => void);
  const capture = new StdoutCapture(() => runReport.cacheDir());
  let restored = false;
  const restoreStdout = (): void => {
    if (restored) return;
    restored = true;
    process.stdout.write = originalStdoutWrite;
  };
  const originalStdoutWrite = process.stdout.write;
  const interceptor = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    capture.write(text);
    return true;
  }) as typeof process.stdout.write;
  if (machine) process.stdout.write = interceptor;
  let documents = 0;
  /** Exactly one machine document per run; a second attempt is refused loudly. */
  const documentWrite = (text: string): void => {
    if (documents > 0) {
      process.stderr.write("cinecode: machine mode already wrote its document; refusing a second one\n");
      return;
    }
    documents += 1;
    stdoutWrite(text);
  };
  runReport.reset();
  runReport.start("cinecode", machine);
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
    runReport.relabel(token ?? "cinecode");
    const spec = token ? findCommand(token) : undefined;

    if (spec) {
      runReport.describe(spec);
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
      if (opts.verbose === true) process.env.CINECODE_VERBOSE = "1";
      if (applied.length > 0 && opts.verbose === true) console.error(`cinecode: alias ${applied.join(", ")}`);
      if (opts.json === true) {
        const { setJsonMode } = await import("../observability/logger.js");
        setJsonMode(true);
        jsonMode = true;
      }
    });

    await program.parseAsync(["node", "cinecode", ...hoistGlobalOptions(args, tokenIndex)]);
    if (machine && process.stdout.write !== interceptor) {
      throw createError(ErrorCode.CC9002, { reason: "machine mode stdout was replaced during the command" });
    }
    const report = withCapturedOutput(runReport.finish(), capture);
    restoreStdout();
    const informational = token !== undefined && INFORMATIONAL_COMMANDS.has(token);
    if (informational) {
      if (capture.bytes() > 0) stdoutWrite(capture.text());
    } else if (machine) {
      writeMachine(report, documentWrite);
    } else {
      for (const warning of report.warnings) {
        process.stderr.write(`⚠ [${warning.code}] ${warning.message}\n`);
      }
      stdoutWrite(`\n${runReport.summary(report)}\n`);
    }
    return EXIT_CODES.success;
  } catch (error) {
    const verbose = program.opts().verbose === true || args.includes("--verbose");
    restoreStdout();
    /* Help and version are clean exits at the reporting boundary, not failures. */
    if (error instanceof CommanderError && error.exitCode === 0) {
      if (capture.bytes() > 0) stdoutWrite(capture.text());
      return EXIT_CODES.success;
    }
    return reportError(error, verbose, !noColor, machine, documentWrite);
  } finally {
    restoreStdout();
    if (jsonMode) {
      const { setJsonMode } = await import("../observability/logger.js");
      setJsonMode(false);
    }
    if (noColor) {
      if (previousNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previousNoColor;
    }
    if (previousVerbose === undefined) delete process.env.CINECODE_VERBOSE;
    else process.env.CINECODE_VERBOSE = previousVerbose;
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
  program.addHelpText(
    "after",
    `\nCommands:\n${commandNames()
      .map((name) => `  ${name.padEnd(22)}${COMMANDS.find((c) => c.name === name)?.summary ?? ""}`)
      .join("\n")}\n\nProject discovery:\n  --root <dir> or --config <path> wins. Otherwise the nearest cinecode config is used,\n  searching upward stops at package.json or .git, and parent projects are never searched.\n\nExit codes:\n${Object.entries(EXIT_CODES)
      .map(([name, code]) => `  ${String(code).padStart(3)}  ${EXIT_CODE_MEANINGS[name as keyof typeof EXIT_CODE_MEANINGS]}`)
      .join("\n")}`,
  );

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
