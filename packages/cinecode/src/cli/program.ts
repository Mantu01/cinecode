import { Command, CommanderError, Option } from "commander";
import path from "node:path";
import { CINECODE_VERSION } from "../version.js";
import {
  COMMANDS,
  findCommand,
  suggestCommand,
  formatHelpText,
  buildCommanderCommand,
  attachCommandHelp,
  type CommandSpec,
  commandNames,
} from "./command-registry.js";
import { EXIT_CODES, EXIT_CODE_MEANINGS, ExitSignal, CancellationSignal, isCancellation, exitCodeForError } from "./exit-codes.js";
import { UsageError } from "./usage-error.js";
import { loadEnabledAliases, resolveAliases } from "./profiles.js";
import { createError, ErrorCode, formatError, isCinecodeError, type CinecodeError } from "../errors/index.js";
import { runReport, validateMachineReport, type MachineErrorRecord, type MachineReport } from "./run-report.js";
import { Reporter, serializeEnvelope } from "./reporter.js";
import { sweepSpools } from "./spool.js";

import { preParseArgs } from "./option-parser.js";

/** Single source for the global options every command exposes. */
const GLOBAL_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["--root <dir>", "Project root directory"],
  ["--config <path>", "Config file path"],
  ["--json", "Emit machine-readable output"],
  ["--no-color", "Disable coloured output"],
  ["--verbose", "Verbose output"],
];

const PASSTHROUGH_TOKENS = new Set(["help", "version", "licence", "license"]);

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

function describeCommand(command: Command, spec: CommandSpec): Command {
  applyGlobalOptions(command);
  attachCommandHelp(command, spec);
  return command;
}

function registerStubs(program: Command): void {
  const existing = new Set(program.commands.map((command) => command.name()));
  for (const spec of COMMANDS) {
    if (existing.has(spec.name)) continue;
    const command = program.command(spec.name).description(spec.summary).allowUnknownOption().allowExcessArguments();
    if (spec.aliases) {
      for (const alias of spec.aliases) {
        command.alias(alias);
      }
    }
    describeCommand(command, spec);
  }
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
  if (isCancellation(error)) {
    const coded = isCinecodeError(error)
      ? error
      : createError(ErrorCode.CC4003, { reason: error instanceof Error ? error.message : "operation cancelled" });
    return {
      exitCode: EXIT_CODES.cancelled,
      error: { code: coded.code, message: coded.message, fixHint: coded.fixHint },
      errorObject: coded,
    };
  }
  if (error instanceof ExitSignal) {
    const coded = createError(ErrorCode.CC9001, { reason: error.message });
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
  write(`${serializeEnvelope(doc)}\n`);
}

function reportError(
  error: unknown,
  verbose: boolean,
  color: boolean,
  machine: boolean,
  reporter: Reporter,
): number {
  const failure = describeFailure(error);
  if (!machine) {
    if (failure.errorObject) console.error(formatError(failure.errorObject, verbose, color));
    else if (failure.plainMessage) console.error(failure.plainMessage);
  }
  const envelope = reporter.errorReport(failure.error, failure.exitCode);
  reporter.writeDocument(envelope);
  return failure.exitCode;
}

/** Informational commands print text only: no envelope, no summary, no error line. */
export const INFORMATIONAL_COMMANDS = new Set(["help", "version", "licence", "license"]);

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
  const stdoutWrite = options.stdout ?? (process.stdout.write.bind(process.stdout) as (text: string) => void);
  const stderrWrite = options.stderr ?? ((text: string) => void process.stderr.write(text));

  let preParsed: ReturnType<typeof preParseArgs>;
  try {
    preParsed = preParseArgs(raw, (name) => findCommand(name) !== undefined || PASSTHROUGH_TOKENS.has(name));
  } catch (err) {
    const failure = describeFailure(err);
    if (raw.includes("--json")) {
      const reporter = new Reporter({
        machine: true,
        quiet: raw.includes("--quiet") || raw.includes("-q"),
        noColor: raw.includes("--no-color"),
        stdoutWrite,
        stderrWrite,
      });
      reporter.writeDocument(reporter.errorReport(failure.error, failure.exitCode));
    } else {
      if (failure.errorObject) console.error(formatError(failure.errorObject, false, !raw.includes("--no-color")));
      else if (failure.plainMessage) console.error(failure.plainMessage);
    }
    return failure.exitCode;
  }

  const showAll = preParsed.globalOptions.all;
  const program = createProgram(showAll);
  const noColor = preParsed.globalOptions.noColor;
  const previousNoColor = process.env.NO_COLOR;
  const previousVerbose = process.env.CINECODE_VERBOSE;
  const machine = preParsed.globalOptions.json;

  const reporter = new Reporter({
    machine,
    quiet: raw.includes("--quiet") || raw.includes("-q"),
    verbose: preParsed.globalOptions.verbose,
    noColor,
    stdoutWrite,
    stderrWrite,
  });
  runReport.setReporter(reporter);

  // Sweep spools at run start per bounded cache rules
  sweepSpools(path.join(cwd, ".cinecode", "cache"));

  reporter.start("cinecode", machine);
  let jsonMode = false;
  let applied: readonly string[] = [];
  let token = preParsed.commandToken;
  let commandArgs = [...preParsed.commandArgs];

  if (noColor) process.env.NO_COLOR = "1";

  try {
    if (token && !PASSTHROUGH_TOKENS.has(token) && !findCommand(token)) {
      const resolution = resolveAliases(
        [token, ...commandArgs],
        loadEnabledAliases(cwd),
        (name) => findCommand(name) !== undefined || PASSTHROUGH_TOKENS.has(name),
        0,
      );
      applied = resolution.applied;
      token = resolution.args[0];
      commandArgs = resolution.args.slice(1);
      if (applied.length > 0 && (!token || (!findCommand(token) && !PASSTHROUGH_TOKENS.has(token)))) {
        const suggestion = token ? suggestCommand(token) : undefined;
        throw new UsageError(
          `Alias ${applied.join(", ")} does not resolve to a known command${suggestion ? `; did you mean ${suggestion}?` : "."}`,
        );
      }
    }

    if (token) {
      const spec = findCommand(token);
      if (spec) {
        if (spec.aliasDeprecations && token in spec.aliasDeprecations) {
          const warning = spec.aliasDeprecations[token]!;
          if (!machine) {
            reporter.warn("CC1014", warning);
          }
        }
        if (token === "media:list") {
          token = "media";
          commandArgs = ["list", ...commandArgs];
        } else if (token === "media:download") {
          token = "media";
          commandArgs = ["download", ...commandArgs];
        } else if (token === "sync") {
          token = "clean";
          if (!commandArgs.includes("--prune")) commandArgs.push("--prune");
        } else if (token === "render-multi") {
          token = "render";
        } else if (token === "health") {
          token = "doctor";
          if (!machine && !commandArgs.includes("--json")) {
            commandArgs.push("--json");
          }
        } else if (token === "create") {
          token = "init";
        } else if (token === "check") {
          token = "validate";
        } else if (token === "license") {
          token = "licence";
        }
      }
    }

    reporter.relabel(token ?? "cinecode");
    const spec = token ? findCommand(token) : undefined;

    if (spec) {
      reporter.describe(spec);
      program.addCommand(describeCommand(await spec.load(), spec));
    } else if (token === "help") {
      const target = commandArgs[0] ? findCommand(commandArgs[0]) : undefined;
      if (target) program.addCommand(describeCommand(await target.load(), target));
      else registerStubs(program);
    } else {
      registerStubs(program);
    }

    configureRunOutput(program, options);

    program.hook("preAction", async (_thisCommand, actionCommand) => {
      const opts = actionCommand.opts();
      if (opts.verbose === true || preParsed.globalOptions.verbose) process.env.CINECODE_VERBOSE = "1";
      if (applied.length > 0 && (opts.verbose === true || preParsed.globalOptions.verbose)) console.error(`cinecode: alias ${applied.join(", ")}`);
      if (opts.json === true || preParsed.globalOptions.json) {
        const { setJsonMode } = await import("../observability/logger.js");
        setJsonMode(true);
        jsonMode = true;
      }
    });

    const executionTokens = ["node", "cinecode"];
    if (token) executionTokens.push(token);
    if (preParsed.globalOptions.root) executionTokens.push(`--root=${preParsed.globalOptions.root}`);
    if (preParsed.globalOptions.config) executionTokens.push(`--config=${preParsed.globalOptions.config}`);
    if (preParsed.globalOptions.json) executionTokens.push("--json");
    if (preParsed.globalOptions.noColor) executionTokens.push("--no-color");
    if (preParsed.globalOptions.verbose) executionTokens.push("--verbose");
    if (preParsed.globalOptions.all) executionTokens.push("--all");
    if (preParsed.globalOptions.help) executionTokens.push("--help");
    if (preParsed.globalOptions.version) executionTokens.push("--version");
    executionTokens.push(...commandArgs);

    await program.parseAsync(executionTokens);

    const informational = token !== undefined && INFORMATIONAL_COMMANDS.has(token);
    if (!informational) {
      const report = reporter.finish(EXIT_CODES.success);
      reporter.writeDocument(report);
    }
    return EXIT_CODES.success;
  } catch (error) {
    const verbose = program.opts().verbose === true || preParsed.globalOptions.verbose;
    /* Help and version are clean exits at the reporting boundary, not failures. */
    if (error instanceof CommanderError && error.exitCode === 0) {
      return EXIT_CODES.success;
    }
    return reportError(error, verbose, !noColor, machine, reporter);
  } finally {
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

export function createProgram(showAll = false): Command {
  const program = new Command()
    .name("cinecode")
    .description("Code-first 2D animation engine and video generation framework")
    .version(CINECODE_VERSION)
    .allowExcessArguments(false)
    .enablePositionalOptions()
    .showSuggestionAfterError(true)
    .exitOverride();

  applyGlobalOptions(program);
  program.addHelpText("after", formatHelpText(showAll));

  return program;
}
