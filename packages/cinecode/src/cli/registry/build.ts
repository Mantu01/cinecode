import { Command, Option } from "commander";
import { validateNumericBounds } from "../parse/option-parser.js";
import { runPreflight } from "../gate/preflight.js";
import type { CommandSpec } from "./types.js";

function defaultLabel(option: Option): string {
  if (option.defaultValue !== undefined) return JSON.stringify(option.defaultValue);
  if (option.negate) return "true";
  if (option.isBoolean()) return "false";
  return "unset";
}

export function attachCommandHelp(command: Command, specOrExample: CommandSpec | string): void {
  const defaults = command.options
    .map((option) => `  ${option.flags.padEnd(42)} ${defaultLabel(option)}`)
    .join("\n");
  const example = typeof specOrExample === "string" ? specOrExample : (specOrExample.examples[0] ?? `cinecode ${specOrExample.name}`);
  const contractInfo = typeof specOrExample === "object" && specOrExample.contract
    ? `\n\nContract:\n  Reads:  ${specOrExample.contract.reads.join(", ") || "none"}\n  Writes: ${specOrExample.contract.writes.join(", ") || "none"}`
    : "";
  command.addHelpText(
    "after",
    `\nExample:\n  ${example}${contractInfo}\n\nDefaults ("unset" resolves from project config or the command fallback):\n${defaults}`,
  );
}

export async function executeCommandWithGate(
  spec: CommandSpec,
  optionsOrArgs: unknown,
  positionalOrOptions?: unknown,
  knownCommandNames: readonly string[] = [],
): Promise<void> {
  const options = (
    Array.isArray(optionsOrArgs) ? (positionalOrOptions ?? {}) : (optionsOrArgs ?? {})
  ) as Record<string, unknown>;
  const positionalArgs = (
    Array.isArray(optionsOrArgs) ? optionsOrArgs : (positionalOrOptions ?? [])
  ) as unknown[];

  await runPreflight(spec, positionalArgs, options, knownCommandNames);
}

export function buildCommanderCommand(spec: CommandSpec, knownCommandNames: readonly string[] = []): Command {
  const cmd = new Command(spec.name).description(spec.summary);

  if (spec.aliases && spec.aliases.length > 0) {
    for (const alias of spec.aliases) {
      cmd.alias(alias);
    }
  }

  if (spec.usage) {
    cmd.arguments(spec.usage);
  }

  for (const opt of spec.options) {
    const option = new Option(opt.flags, opt.description);
    if (opt.flags.startsWith("--no-")) {
      option.attributeName = () => opt.name;
      option.negate = false;
    }
    if (opt.choices && opt.choices.length > 0) {
      option.choices(opt.choices);
    }
    if (opt.default !== undefined) {
      option.default(opt.default);
    }
    if (opt.conflicts && opt.conflicts.length > 0) {
      for (const conflict of opt.conflicts) {
        option.conflicts(conflict);
      }
    }
    if (opt.hidden) {
      option.hideHelp(true);
    }
    if (opt.type === "number") {
      option.argParser((val: string) => validateNumericBounds(opt, val));
    }
    cmd.addOption(option);
  }

  attachCommandHelp(cmd, spec);

  cmd.action(async (...actionArgs: unknown[]) => {
    const commandInstance = actionArgs[actionArgs.length - 1] as Command;
    const tail = actionArgs.length > 1 ? actionArgs[actionArgs.length - 2] : {};
    const variadic = Array.isArray(tail);
    const rawOptions = (!variadic && tail !== null && typeof tail === "object" ? tail : {}) as Record<string, unknown>;
    const combinedOptions = {
      ...commandInstance.optsWithGlobals(),
      ...rawOptions,
    };
    const positionalArgs = actionArgs.slice(0, Math.max(0, actionArgs.length - (variadic ? 1 : 2)));

    await executeCommandWithGate(spec, combinedOptions, positionalArgs, knownCommandNames);
  });

  return cmd;
}
