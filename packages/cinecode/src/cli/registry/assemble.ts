import type { CommandSpec, SerializableCommandSpec } from "./types.js";
import { PRODUCT_RENDER_COMMANDS } from "./commands-product-render.js";
import { PRODUCT_AUTHOR_COMMANDS } from "./commands-product-author.js";
import { RESOURCE_COMMANDS } from "./commands-resource.js";
import { MAINTENANCE_COMMANDS } from "./commands-maintenance.js";
import { runReport } from "../output/run-report.js";
import { CINECODE_VERSION } from "../../version.js";
import type { CommandActionFunction } from "./types.js";

const LICENSE = `Cinecode is MIT licensed.

Copyright (c) Cinecode contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.`;

export const INFORMATIONAL_COMMANDS: readonly CommandSpec[] = [
  {
    name: "help",
    summary: "Show help for Cinecode commands",
    category: "informational",
    outcome: "none",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: ["command registry"],
      writes: ["stdout"],
    },
    usage: "[command]",
    examples: ["cinecode help", "cinecode help render", "cinecode help --all"],
    machineResult: { type: "object", properties: { help: { type: "string" }, commands: { type: "array" }, command: { type: "object" }, usage: { type: "string" }, options: { type: "array" } } },
    options: [
      { name: "all", flags: "--all", description: "Show all commands including maintenance and informational", type: "boolean", default: false },
    ],
    loadAction: async () => {
      const action: CommandActionFunction = async (optionsOrCmd?: unknown, maybeOptions?: unknown) => {
        const options = (typeof optionsOrCmd === "object" && optionsOrCmd !== null ? optionsOrCmd : maybeOptions ?? {}) as Record<string, unknown>;
        const commandName = typeof optionsOrCmd === "string" ? optionsOrCmd : undefined;
        if (commandName) {
          const target = findCommand(commandName);
          if (target) {
            const { buildCommanderCommand } = await import("./build.js");
            buildCommanderCommand(target).outputHelp();
            return;
          }
        }
        runReport.writeRawStdout(`${formatHelpText(options.all === true)}\n`);
      };
      return action;
    },
  },
  {
    name: "version",
    summary: "Show the Cinecode version",
    category: "informational",
    outcome: "none",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: ["package.json"],
      writes: ["stdout"],
    },
    examples: ["cinecode version"],
    machineResult: { type: "object", properties: { version: { type: "string" }, framework: { type: "string" }, node: { type: "string" } } },
    options: [],
    loadAction: async () => {
      return () => {
        runReport.writeRawStdout(`${CINECODE_VERSION}\n`);
      };
    },
  },
  {
    name: "licence",
    aliases: ["license"],
    aliasDeprecations: {
      "license": "Use 'licence' instead.",
    },
    summary: "Show license information",
    category: "informational",
    outcome: "none",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: ["LICENSE file"],
      writes: ["stdout"],
    },
    examples: ["cinecode licence", "cinecode license"],
    machineResult: { type: "object", properties: { license: { type: "string" }, text: { type: "string" }, dependencies: { type: "array" } } },
    options: [],
    loadAction: async () => {
      return () => {
        runReport.writeRawStdout(`${LICENSE}\n`);
      };
    },
  },];

export const COMMANDS: readonly CommandSpec[] = [
  ...PRODUCT_RENDER_COMMANDS,
  ...PRODUCT_AUTHOR_COMMANDS,
  ...RESOURCE_COMMANDS,
  ...MAINTENANCE_COMMANDS,
  ...INFORMATIONAL_COMMANDS,
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name || command.aliases?.includes(name));
}

export function commandNames(): string[] {
  return COMMANDS.map((command) => command.name);
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= a.length; column += 1) {
      const cost = a[column - 1] === b[row - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1, previous[column - 1]! + cost);
    }
    previous = current;
  }
  return previous[a.length]!;
}

/** Closest documented command name or alias, or undefined when nothing is close enough. */
export function suggestCommand(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 4;
  for (const command of COMMANDS) {
    const candidates = [command.name, ...(command.aliases ?? [])];
    for (const candidate of candidates) {
      const next = distance(name, candidate);
      if (next < bestDistance) {
        best = command.name;
        bestDistance = next;
      }
    }
  }
  return best;
}

export function serializeRegistry(): SerializableCommandSpec[] {
  return JSON.parse(JSON.stringify(COMMANDS.map((cmd) => {
    const { loadAction, ...rest } = cmd;
    return rest;
  }))) as SerializableCommandSpec[];
}

export function formatHelpText(showAll = false): string {
  const productCmds = COMMANDS.filter((c) => c.category === "product" && !c.hidden);
  const resourceCmds = COMMANDS.filter((c) => c.category === "resource" && !c.hidden);
  const maintenanceCmds = COMMANDS.filter((c) => c.category === "maintenance");
  const infoCmds = COMMANDS.filter((c) => c.category === "informational");

  const formatGroup = (title: string, cmds: readonly CommandSpec[]) => {
    const lines = [title];
    for (const cmd of cmds) {
      lines.push(`  ${cmd.name.padEnd(20)}${cmd.summary}`);
    }
    return lines.join("\n");
  };

  const sections = [
    formatGroup("Product Commands:", productCmds),
    formatGroup("Resource Commands:", resourceCmds),
  ];

  if (showAll) {
    sections.push(formatGroup("Maintenance Commands:", maintenanceCmds));
    sections.push(formatGroup("Informational Commands:", infoCmds));

    const aliasLines: string[] = [];
    for (const cmd of COMMANDS) {
      if (cmd.aliases && cmd.aliases.length > 0) {
        for (const alias of cmd.aliases) {
          aliasLines.push(`  ${alias.padEnd(20)}-> ${cmd.name}`);
        }
      }
    }
    if (aliasLines.length > 0) {
      sections.push("Forwarding Aliases:\n" + aliasLines.join("\n"));
    }
  } else {
    sections.push("(Run `cinecode help --all` to show maintenance commands)");
  }

  sections.push(
    "Project discovery:\n  --root <dir> or --config <path> wins. Otherwise the nearest cinecode config is used,\n  searching upward stops at package.json or .git, and parent projects are never searched.",
  );

  return `\n${sections.join("\n\n")}`;
}

