import { Command, Option } from "commander";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { listPresetIds } from "../encoder/platform-presets.js";
import { DEFAULTS } from "../config/defaults.js";
import { CINECODE_VERSION } from "../version.js";
import { validateNumericBounds, validateCommandOptions } from "./option-parser.js";
import { runPreflight } from "./preflight.js";

export type CommandOutcome = "none" | "artifact" | "report";
export type CommandKind = "read" | "write" | "network" | "destructive";
export type CommandCategory = "product" | "resource" | "maintenance" | "informational";
export type OptionType = "string" | "number" | "boolean" | "path" | "enum";
export type ProjectSelectorRule = "selection" | "scene" | "timeline" | "optional" | "none";

export interface CommandOptionSpec {
  readonly name: string;
  readonly flags: string;
  readonly description: string;
  readonly type: OptionType;
  readonly default?: unknown;
  readonly choices?: readonly string[];
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly conflicts?: readonly string[];
  readonly requires?: readonly string[];
  readonly hidden?: boolean;
}

export interface DeclaredResultShape {
  readonly type: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly items?: unknown;
  readonly description?: string;
}

export interface CommandContract {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

export type CommandActionFunction = (...args: unknown[]) => Promise<void> | void;

export interface CommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly aliasDeprecations?: Readonly<Record<string, string>>;
  readonly summary: string;
  readonly description?: string;
  readonly usage?: string;
  readonly category: CommandCategory;
  readonly contract: CommandContract;
  readonly options: readonly CommandOptionSpec[];
  readonly requiredProject: boolean;
  readonly projectSelectorRule?: ProjectSelectorRule;
  readonly outcome: CommandOutcome;
  readonly kind: CommandKind;
  readonly hidden: boolean;
  readonly examples: readonly string[];
  readonly machineResult: DeclaredResultShape;
  readonly expectedArtifactKind?: "video" | "image" | "artifact";
  readonly network: boolean;
  readonly destructive: boolean;
  readonly loadAction: () => Promise<CommandActionFunction>;
  readonly load: () => Promise<Command>;
}

export interface SerializableCommandOption {
  readonly name: string;
  readonly flags: string;
  readonly description: string;
  readonly type: OptionType;
  readonly default?: unknown;
  readonly choices?: readonly string[];
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly conflicts?: readonly string[];
  readonly requires?: readonly string[];
  readonly hidden?: boolean;
}

export interface SerializableCommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly aliasDeprecations?: Readonly<Record<string, string>>;
  readonly summary: string;
  readonly usage?: string;
  readonly category: CommandCategory;
  readonly contract: CommandContract;
  readonly options: readonly SerializableCommandOption[];
  readonly requiredProject: boolean;
  readonly projectSelectorRule?: ProjectSelectorRule;
  readonly outcome: CommandOutcome;
  readonly kind: CommandKind;
  readonly hidden: boolean;
  readonly examples: readonly string[];
  readonly machineResult: DeclaredResultShape;
}

const LICENSE = `Cinecode is MIT licensed.

Copyright (c) Cinecode contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.`;

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
): Promise<void> {
  const options = (
    Array.isArray(optionsOrArgs) ? (positionalOrOptions ?? {}) : (optionsOrArgs ?? {})
  ) as Record<string, unknown>;
  const positionalArgs = (
    Array.isArray(optionsOrArgs) ? optionsOrArgs : (positionalOrOptions ?? [])
  ) as unknown[];

  await runPreflight(spec, positionalArgs, options);
}

export function buildCommanderCommand(spec: CommandSpec): Command {
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
    const rawOptions = (actionArgs.length > 1 ? actionArgs[actionArgs.length - 2] : {}) as Record<string, unknown>;
    const combinedOptions = {
      ...commandInstance.optsWithGlobals(),
      ...rawOptions,
    };
    const positionalArgs = actionArgs.slice(0, Math.max(0, actionArgs.length - 2));

    await executeCommandWithGate(spec, combinedOptions, positionalArgs);
  });

  return cmd;
}

export const COMMANDS: readonly CommandSpec[] = [
  // 10 Product Commands
  {
    name: "dev",
    summary: "Start the dev server with HMR",
    category: "product",
    outcome: "none",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["cinecode.config.ts", "source timelines and assets"],
      writes: [".cinecode/cache", ".cinecode/spool"],
    },
    examples: ["cinecode dev --config ./cinecode.config.ts"],
    machineResult: { type: "object", properties: { port: { type: "number" }, host: { type: "string" }, url: { type: "string" }, pid: { type: "number" } } },
    options: [
      { name: "port", flags: "-p, --port <number>", description: "Port to listen on", type: "number", bounds: { min: 1, max: 65535 }, default: DEFAULTS.dev.port },
      { name: "host", flags: "--host <host>", description: "Host to bind", type: "string", default: DEFAULTS.dev.host },
      { name: "open", flags: "--open", description: "Open the preview in the browser", type: "boolean", default: DEFAULTS.dev.open },
      { name: "noHmr", flags: "--no-hmr", description: "Disable the HMR socket push", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./dev.js")).devCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "preview",
    summary: "Start the read-only preview server and open viewer",
    category: "product",
    outcome: "none",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["cinecode.config.ts", "source timelines and assets"],
      writes: [".cinecode/cache"],
    },
    examples: ["cinecode preview --config ./cinecode.config.ts"],
    machineResult: { type: "object", properties: { port: { type: "number" }, url: { type: "string" }, pid: { type: "number" } } },
    options: [
      { name: "port", flags: "-p, --port <number>", description: "Port to listen on", type: "number", bounds: { min: 1, max: 65535 }, default: DEFAULTS.dev.port },
      { name: "host", flags: "--host <host>", description: "Host to bind", type: "string", default: DEFAULTS.dev.host },
      { name: "open", flags: "--open", description: "Open the preview in the browser", type: "boolean", default: DEFAULTS.dev.open },
      { name: "timeline", flags: "-T, --timeline <id>", description: "Timeline id from main.ts", type: "string", default: undefined },
      { name: "scene", flags: "-s, --scene <id>", description: "Scene id from main.ts", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./preview.js")).previewCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "render",
    aliases: ["render-multi"],
    aliasDeprecations: {
      "render-multi": "Use 'render --variants' / 'render --resolutions' instead.",
    },
    summary: "Render timelines or a composition to a video",
    category: "product",
    outcome: "artifact",
    expectedArtifactKind: "video",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "selection",
    contract: {
      reads: ["cinecode.config.ts", "source timelines and assets", ".cinecode/cache"],
      writes: ["output video file", ".cinecode/cache", ".cinecode/spool"],
    },
    examples: ["cinecode render --config ./cinecode.config.ts", "cinecode render --file ./composition.ts"],
    machineResult: {
      type: "object",
      properties: {
        rendered: { type: "number" },
        budget: { type: "object" },
        audioPlacements: { type: "array" },
        presets: { type: "array" },
        chunkSize: { type: "number" },
        hardwareAcceleration: { type: "string" },
        explain: { type: "object" },
        dryRun: { type: "boolean" },
      },
    },
    options: [
      { name: "file", flags: "--file <path>", description: "Standalone composition file (file mode)", type: "path", default: undefined },
      { name: "composition", flags: "-c, --composition <name>", description: "Composition name (requires --file)", type: "string", default: undefined, requires: ["file"] },
      { name: "timeline", flags: "-T, --timeline <id>", description: "Timeline id from main.ts", type: "string", default: undefined },
      { name: "scene", flags: "-s, --scene <id>", description: "Scene id from main.ts", type: "string", default: undefined },
      { name: "all", flags: "--all", description: "Render every timeline (default when no selector is given)", type: "boolean", default: false },
      { name: "preview", flags: "--preview", description: "Render preview quality (faster, appends .preview suffix)", type: "boolean", default: false },
      { name: "out", flags: "-o, --out <path>", description: "Output file path", type: "path", default: undefined },
      { name: "from", flags: "--from <time>", description: "Start time", type: "string", default: undefined },
      { name: "to", flags: "--to <time>", description: "End time (clamped with degradation CC4001 if exceeding duration)", type: "string", default: undefined },
      { name: "format", flags: "--format <format>", description: "Output container format: mp4, mov, webm, gif, prores, wav, mp3", type: "enum", choices: ["mp4", "mov", "webm", "gif", "prores", "wav", "mp3"], default: undefined },
      { name: "codec", flags: "--codec <codec>", description: "Video codec: h264, h265, prores, vp9, av1, raw", type: "enum", choices: ["h264", "h265", "prores", "vp9", "av1", "raw"], default: undefined },
      { name: "quality", flags: "-q, --quality <level>", description: "Output quality level", type: "enum", choices: ["draft", "preview", "medium", "final", "lossless", "low", "high"], default: undefined },
      { name: "crf", flags: "--crf <n>", description: "Constant Rate Factor (0-51)", type: "number", bounds: { min: 0, max: 51 }, default: undefined },
      { name: "preset", flags: "--preset <name>", description: `Platform preset (${listPresetIds().join(", ")})`, type: "string", default: undefined },
      { name: "fps", flags: "--fps <n>", description: "Override composition framerate", type: "number", bounds: { min: 1, max: 240 }, default: undefined },
      { name: "resolution", flags: "--resolution <WIDTHxHEIGHT>", description: "Override resolution", type: "string", default: undefined },
      { name: "resolutions", flags: "--resolutions <list>", description: "Comma-separated resolutions to render", type: "string", default: undefined },
      { name: "variants", flags: "--variants <list>", description: "Comma-separated variants to render", type: "string", default: undefined },
      { name: "concurrency", flags: "--concurrency <n|auto>", description: "Worker thread concurrency", type: "string", default: "auto" },
      { name: "chunkSize", flags: "--chunk-size <frames>", description: "Frames per worker chunk", type: "number", bounds: { min: 1, max: 10000 }, default: undefined },
      { name: "hardwareAcceleration", flags: "--hardware-acceleration <mode>", description: "Encoder backend: auto, nvenc, videotoolbox, vaapi, none", type: "enum", choices: ["auto", "nvenc", "videotoolbox", "vaapi", "none"], default: undefined },
      { name: "range", flags: "-r, --range <range>", description: "Frame range to render (e.g. 0-100)", type: "string", default: undefined },
      { name: "dryRun", flags: "--dry-run", description: "Print render plan without rendering", type: "boolean", default: false },
      { name: "fresh", flags: "--fresh", description: "Ignore caches and render every frame anew", type: "boolean", default: false },
      { name: "resume", flags: "--resume", description: "Resume from the last durable render checkpoint", type: "boolean", default: false },
      { name: "noCache", flags: "--no-cache", description: "Do not read or write the frame cache", type: "boolean", default: false },
      { name: "overwrite", flags: "--overwrite", description: "Overwrite output file if it exists", type: "boolean", default: false },
      { name: "allowInvalid", flags: "--allow-invalid", description: "Render even when timeline validation reports fatal issues", type: "boolean", default: false },
      { name: "strict", flags: "--strict", description: "Fail when text glyphs fall back to another font family", type: "boolean", default: false },
      { name: "seed", flags: "--seed <number>", description: "Random seed", type: "number", bounds: { min: 0 }, default: undefined },
      { name: "memoryBudget", flags: "--memory-budget <bytes>", description: "Max memory for chunk buffers (e.g. 2GB, 512MB)", type: "string", default: DEFAULTS.memoryBudget },
      { name: "noEffects", flags: "--no-effects", description: "Disable all effects (fastest render)", type: "boolean", default: false, conflicts: ["effects"] },
      { name: "effects", flags: "--effects <list>", description: "Comma-separated list of effects to apply", type: "string", default: undefined, conflicts: ["noEffects"] },
      { name: "alpha", flags: "--alpha", description: "Render with alpha channel (transparent background)", type: "boolean", default: false },
      { name: "twoPass", flags: "--two-pass", description: "Enable two-pass video encoding", type: "boolean", default: false },
      { name: "bitrate", flags: "--bitrate <rate>", description: "Video bitrate target (e.g. 5000k)", type: "string", default: undefined },
      { name: "withAudio", flags: "--with-audio", description: "Keep an audio stream even when the mix is silent", type: "boolean", default: false },
      { name: "audioCodec", flags: "--audio-codec <codec>", description: "Audio codec: aac, opus, ac3, eac3, flac, pcm_s24le", type: "enum", choices: ["aac", "opus", "ac3", "eac3", "flac", "pcm_s24le"], default: undefined },
      { name: "audioBitrate", flags: "--audio-bitrate <kbps>", description: "Audio bitrate in kbps for lossy codecs", type: "number", bounds: { min: 8, max: 1024 }, default: undefined },
      { name: "colorManagement", flags: "--color-management <space>", description: "Color management mode: srgb or linear", type: "enum", choices: ["srgb", "linear"], default: undefined },
      { name: "lut", flags: "--lut <path>", description: "Path to a .cube LUT file for color grading", type: "path", default: undefined },
      { name: "gifQuality", flags: "--gif-quality <n>", description: "GIF quality 1-8", type: "number", bounds: { min: 1, max: 8 }, default: undefined },
      { name: "gifDither", flags: "--gif-dither <mode>", description: "GIF dithering", type: "enum", choices: ["floyd-steinberg", "sierra-2", "atkinson", "none"], default: undefined },
      { name: "gifMaxFrames", flags: "--gif-max-frames <n>", description: "Maximum frames in GIF output", type: "number", bounds: { min: 1 }, default: undefined },
      { name: "listPresets", flags: "--list-presets", description: "List available platform presets", type: "boolean", default: false },
      { name: "explain", flags: "--explain", description: "Print resolved parameters and their origins without rendering", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./render.js")).renderCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "still",
    summary: "Render a single frame to PNG or JPEG",
    category: "product",
    outcome: "artifact",
    expectedArtifactKind: "image",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "selection",
    contract: {
      reads: ["cinecode.config.ts", "source timelines and assets"],
      writes: ["output image file"],
    },
    examples: ["cinecode still ./composition.ts --frame 0"],
    machineResult: {
      type: "object",
      properties: {
        composition: { type: "string" },
        frame: { type: "number" },
        output: { type: "string" },
        format: { type: "string" },
        explain: { type: "object" },
      },
    },
    options: [
      { name: "file", flags: "--file <path>", description: "Standalone composition file (file mode)", type: "path", default: undefined },
      { name: "composition", flags: "-c, --composition <name>", description: "Composition name (requires --file)", type: "string", default: undefined, requires: ["file"] },
      { name: "timeline", flags: "-T, --timeline <id>", description: "Timeline id from main.ts", type: "string", default: undefined },
      { name: "scene", flags: "-s, --scene <id>", description: "Scene id from main.ts", type: "string", default: undefined },
      { name: "frame", flags: "-f, --frame <number>", description: "Frame number", type: "number", bounds: { min: 0 }, default: undefined, conflicts: ["time"] },
      { name: "time", flags: "--time <time>", description: "Time (00:00:01.000)", type: "string", default: undefined, conflicts: ["frame"] },
      { name: "out", flags: "-o, --out <path>", description: "Output file path", type: "path", default: undefined },
      { name: "format", flags: "--format <format>", description: "Output format: png, jpg, jpeg, webp", type: "enum", choices: ["png", "jpg", "jpeg", "webp"], default: undefined },
      { name: "resolution", flags: "--resolution <WIDTHxHEIGHT>", description: "Override resolution", type: "string", default: undefined },
      { name: "seed", flags: "--seed <number>", description: "Random seed", type: "number", bounds: { min: 0 }, default: undefined },
      { name: "dryRun", flags: "--dry-run", description: "Print render plan without rendering", type: "boolean", default: false },
      { name: "explain", flags: "--explain", description: "Print resolved parameters and their origins without rendering", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./still.js")).stillCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "generate",
    summary: "Generate images, audio, scenes or timelines",
    category: "product",
    outcome: "artifact",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: ["prompt or input script", "cinecode.config.ts"],
      writes: ["generated composition file"],
    },
    usage: "[target]",
    examples: ["cinecode generate image --all"],
    machineResult: { type: "object", properties: { generated: { type: "array" }, kind: { type: "string" }, count: { type: "number" } } },
    options: [
      { name: "id", flags: "--id <id...>", description: "Only generate the given ids", type: "string", default: undefined },
      { name: "all", flags: "--all", description: "Generate everything without prompting", type: "boolean", default: false },
      { name: "yes", flags: "-y, --yes", description: "Skip prompts and generate everything", type: "boolean", default: false },
      { name: "out", flags: "--out <dir>", description: "Output directory override", type: "path", default: undefined },
      { name: "seed", flags: "--seed <number>", description: "Random seed", type: "number", bounds: { min: 0 }, default: undefined },
      { name: "concurrency", flags: "--concurrency <number>", description: "Concurrent generations", type: "number", bounds: { min: 1, max: 64 }, default: 2 },
      { name: "dryRun", flags: "--dry-run", description: "Preview actions without generating", type: "boolean", default: false },
      { name: "format", flags: "--format <fmt>", description: "Media format override", type: "string", default: undefined },
      { name: "force", flags: "--force", description: "Regenerate even if files exist", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./generate.js")).generateCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "validate",
    aliases: ["check"],
    aliasDeprecations: {
      "check": "Use 'validate' instead.",
    },
    summary: "Validate configuration, compositions, media and fonts",
    category: "product",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: ["cinecode.config.ts", "source timelines and assets"],
      writes: ["none"],
    },
    examples: ["cinecode validate --config ./cinecode.config.ts"],
    machineResult: {
      type: "object",
      properties: {
        valid: { type: "boolean" },
        mode: { type: "string" },
        stoppedAtGate: { type: "string" },
        notes: { type: "array" },
        contract: { type: "object" },
        categories: { type: "object" },
        errors: { type: "array" },
        warnings: { type: "array" },
        manifest: { type: "object" },
        config: { type: "object" },
        references: { type: "array" },
      },
    },
    options: [
      { name: "mode", flags: "--mode <mode>", description: "Validation mode: all, authoring-only, media, fonts", type: "enum", choices: ["all", "authoring-only", "media", "fonts"], default: "all" },
      { name: "strict", flags: "--strict", description: "Treat warnings as errors", type: "boolean", default: false },
      { name: "fix", flags: "--fix", description: "Auto-fix issues where possible", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./validate.js")).validateCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "clean",
    aliases: ["sync"],
    aliasDeprecations: {
      "sync": "Use 'clean --prune' instead.",
    },
    summary: "Delete cache and output directories",
    category: "product",
    outcome: "none",
    kind: "destructive",
    network: false,
    destructive: true,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: [".cinecode/cache", ".cinecode/spool"],
      writes: [".cinecode/cache", ".cinecode/spool"],
    },
    examples: ["cinecode clean --cache"],
    machineResult: {
      type: "object",
      properties: {
        deleted: { type: "array" },
        cleaned: { type: "object" },
        cache: { type: "object" },
        output: { type: "object" },
        files: { type: "number" },
        bytes: { type: "number" },
        summary: { type: "array" },
        dryRun: { type: "boolean" },
        spoolsSwept: { type: "number" },
        spoolsBytes: { type: "number" },
      },
    },
    options: [
      { name: "cache", flags: "--cache", description: "Empty cache directory", type: "boolean", default: false },
      { name: "output", flags: "--output", description: "Also empty output directory", type: "boolean", default: false },
      { name: "all", flags: "--all", description: "Clean both cache and output", type: "boolean", default: false },
      { name: "yes", flags: "-y, --yes", description: "Skip confirmation prompt", type: "boolean", default: false },
      { name: "force", flags: "--force", description: "Skip confirmation prompt", type: "boolean", default: false },
      { name: "dryRun", flags: "--dry-run", description: "Print what would be deleted without deleting", type: "boolean", default: false },
      { name: "prune", flags: "--prune", description: "Prune stale cache entries", type: "boolean", default: false },
      { name: "deleteOrphans", flags: "--delete-orphans", description: "Delete detected orphaned assets", type: "boolean", default: false },
      { name: "pruneStaleDays", flags: "--prune-stale-days <days>", description: "Prune cache entries unreferenced for N days instead of deleting everything", type: "number", bounds: { min: 0 }, default: undefined },
    ],
    loadAction: async () => (await import("./clean.js")).cleanCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "init",
    aliases: ["create"],
    aliasDeprecations: {
      "create": "Use 'init' instead.",
    },
    summary: "Scaffold a new Cinecode project",
    category: "product",
    outcome: "artifact",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["target directory"],
      writes: ["project files", "cinecode.config.ts", "package.json"],
    },
    usage: "[target-dir]",
    examples: ["cinecode init my-film"],
    machineResult: {
      type: "object",
      properties: {
        created: { type: "string" },
        directory: { type: "string" },
        path: { type: "string" },
        dryRun: { type: "boolean" },
        template: { type: "string" },
        name: { type: "string" },
      },
    },
    options: [
      { name: "template", flags: "-t, --template <name>", description: "Project template name", type: "string", default: undefined },
      { name: "name", flags: "-n, --name <name>", description: "Project name", type: "string", default: undefined },
      { name: "yes", flags: "-y, --yes", description: "Skip interactive questionnaire and use defaults", type: "boolean", default: false },
      { name: "ts", flags: "--ts", description: "Use TypeScript", type: "boolean", default: true },
      { name: "js", flags: "--js", description: "Use JavaScript", type: "boolean", default: false },
      { name: "fps", flags: "--fps <number>", description: "Frames per second", type: "number", bounds: { min: 1, max: 240 }, default: DEFAULTS.video.fps },
      { name: "resolution", flags: "--resolution <preset|WxH>", description: "Resolution preset or WxH", type: "string", default: DEFAULTS.render.resolution },
      { name: "noGit", flags: "--no-git", description: "Skip git initialization", type: "boolean", default: false },
      { name: "skipInstall", flags: "--skip-install", description: "Skip dependency installation", type: "boolean", default: false },
      { name: "force", flags: "--force", description: "Proceed even if directory is not empty", type: "boolean", default: false },
      { name: "dryRun", flags: "--dry-run", description: "Print plan without writing files", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./create.js")).createCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "doctor",
    aliases: ["health"],
    aliasDeprecations: {
      "health": "Use 'doctor --json' instead.",
    },
    summary: "Run environment and project health checks",
    category: "product",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["system environment", "ffmpeg binary", "node binary", "cinecode.config.ts"],
      writes: [".gitignore (with --fix)", ".cinecode/cache (with --fix)"],
    },
    examples: ["cinecode doctor --fix"],
    machineResult: { type: "object", properties: { passed: { type: "boolean" }, checks: { type: "array" }, system: { type: "object" } } },
    options: [
      { name: "fix", flags: "--fix", description: "Auto-fix issues where possible", type: "boolean", default: false },
      { name: "strict", flags: "--strict", description: "Exit non-zero when any issue is detected", type: "boolean", default: false },
      { name: "cache", flags: "--cache <dir>", description: "Cache directory to inspect", type: "path", default: undefined },
    ],
    loadAction: async () => (await import("./doctor.js")).doctorCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "inspect",
    summary: "Print the resolved timeline for a composition",
    category: "product",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["cinecode.config.ts", "source composition"],
      writes: ["none"],
    },
    usage: "[entry]",
    examples: ["cinecode inspect ./composition.ts"],
    machineResult: {
      type: "object",
      properties: {
        composition: { type: "string" },
        tracks: { type: "array" },
        manifest: { type: "object" },
        compositions: { type: "array" },
        timelines: { type: "array" },
        scenes: { type: "array" },
        assets: { type: "array" },
        explain: { type: "object" },
        references: { type: "array" },
        resolution: { type: "object" },
      },
    },
    options: [
      { name: "file", flags: "--file <path>", description: "Standalone composition file (file mode)", type: "path", default: undefined },
      { name: "composition", flags: "-c, --composition <name>", description: "Composition name (requires --file)", type: "string", default: undefined, requires: ["file"] },
      { name: "timeline", flags: "--timeline <id>", description: "Timeline id from main.ts", type: "string", default: undefined },
      { name: "scene", flags: "--scene <id>", description: "Scene id from main.ts", type: "string", default: undefined },
      { name: "frame", flags: "-f, --frame <number>", description: "Show clips active at frame", type: "number", bounds: { min: 0 }, default: undefined },
      { name: "time", flags: "--time <time>", description: "Show clips active at time", type: "string", default: undefined },
      { name: "deep", flags: "--deep", description: "Generate deep dependency graph across audio, visual, and effects", type: "boolean", default: false },
      { name: "format", flags: "--format <format>", description: "Graph output format: dot, mermaid, ascii", type: "enum", choices: ["dot", "mermaid", "ascii"], default: undefined },
      { name: "depth", flags: "--depth <number>", description: "Max clip nesting depth to display", type: "number", bounds: { min: 1, max: 100 }, default: 3 },
    ],
    loadAction: async () => (await import("./inspect.js")).inspectCommand as unknown as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },

  // 10 Resource Commands
  {
    name: "media",
    aliases: ["media:list", "media:download"],
    aliasDeprecations: {
      "media:list": "Use 'media list' instead.",
      "media:download": "Use 'media download' instead.",
    },
    summary: "Manage project media files and cloud assets",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: ["cinecode.config.ts", "media sources", "network (download)"],
      writes: ["media directory", ".cinecode/cache"],
    },
    usage: "<action> [args...]",
    examples: ["cinecode media list", "cinecode media download"],
    machineResult: {
      type: "object",
      properties: {
        media: { type: "array" },
        total: { type: "number" },
        missing: { type: "array" },
        unused: { type: "array" },
        downloaded: { type: "array" },
        skipped: { type: "array" },
        failed: { type: "array" },
        files: { type: "array" },
      },
    },
    options: [
      { name: "type", flags: "--type <video|audio|image>", description: "Filter by media type", type: "enum", choices: ["video", "audio", "image"], default: undefined },
      { name: "missing", flags: "--missing", description: "Show only missing referenced media files", type: "boolean", default: false },
      { name: "out", flags: "-o, --out <path>", description: "Output file path", type: "path", default: undefined },
      { name: "force", flags: "--force", description: "Re-download existing files", type: "boolean", default: false },
      { name: "confirm", flags: "--confirm", description: "Explicitly allow network downloads", type: "boolean", default: false },
      { name: "only", flags: "--only <name>", description: "Download only the specified entry", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./media.js")).mediaCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "plugin",
    summary: "Manage installed plugins",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["cinecode.config.ts", "package.json", "plugin manifests"],
      writes: ["plugin files (scaffold)"],
    },
    usage: "<action> [name]",
    examples: ["cinecode plugin list"],
    machineResult: { type: "object", properties: { plugins: { type: "array" }, action: { type: "string" }, target: { type: "string" } } },
    options: [
      { name: "type", flags: "--type <type>", description: "Plugin template type: effect, transition, audio-effect, clip-type", type: "enum", choices: ["effect", "transition", "audio-effect", "clip-type"], default: "effect" },
      { name: "desc", flags: "--desc <description>", description: "Plugin description", type: "string", default: "" },
      { name: "author", flags: "-a, --author <author>", description: "Author name", type: "string", default: "" },
    ],
    loadAction: async () => (await import("./plugin.js")).pluginCommand as unknown as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "formats",
    summary: "List input, output and planned media formats",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["ffmpeg encoders", "system codecs"],
      writes: ["none"],
    },
    examples: ["cinecode formats --json"],
    machineResult: { type: "object", properties: { output: { type: "array" }, input: { type: "array" }, helpers: { type: "array" }, planned: { type: "array" }, formats: { type: "array" } } },
    options: [],
    loadAction: async () => (await import("./formats.js")).formatsCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "presets",
    summary: "List platform deliverable presets",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["built-in presets", "cinecode.config.ts"],
      writes: ["none"],
    },
    usage: "[name]",
    examples: ["cinecode presets --json"],
    machineResult: { type: "object", properties: { presets: { type: "array" }, preset: { type: "object" }, name: { type: "string" }, width: { type: "number" }, height: { type: "number" }, fps: { type: "number" } } },
    options: [
      { name: "listPresets", flags: "--list-presets", description: "List available platform presets", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./presets.js")).presetsCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "thumbnail",
    summary: "Write poster images from the best frame",
    category: "resource",
    outcome: "artifact",
    expectedArtifactKind: "image",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["source composition", "cinecode.config.ts"],
      writes: ["thumbnail image file"],
    },
    examples: ["cinecode thumbnail ./composition.ts"],
    machineResult: { type: "object", properties: { thumbnail: { type: "string" }, frame: { type: "number" }, files: { type: "array" }, candidates: { type: "array" }, score: { type: "object" } } },
    options: [
      { name: "composition", flags: "-c, --composition <name>", description: "Composition name", type: "string", default: undefined },
      { name: "outputDir", flags: "-o, --output-dir <dir>", description: "Output directory", type: "path", default: undefined },
      { name: "count", flags: "-n, --count <number>", description: "Number of candidates to list", type: "number", bounds: { min: 1, max: 100 }, default: 3 },
      { name: "frame", flags: "-f, --frame <number>", description: "Force a specific frame", type: "number", bounds: { min: 0 }, default: undefined },
      { name: "format", flags: "--format <png|jpg|webp>", description: "Image format: png, jpg, webp", type: "enum", choices: ["png", "jpg", "webp"], default: "png" },
      { name: "seed", flags: "--seed <number>", description: "Random seed", type: "number", bounds: { min: 0 }, default: undefined },
    ],
    loadAction: async () => (await import("./thumbnail.js")).thumbnailCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "export-svg",
    summary: "Export frames as vector SVG graphics",
    category: "resource",
    outcome: "artifact",
    expectedArtifactKind: "image",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["source composition", "cinecode.config.ts"],
      writes: ["output svg file"],
    },
    usage: "[entry]",
    examples: ["cinecode export-svg ./main.ts"],
    machineResult: { type: "object", properties: { files: { type: "array" }, composition: { type: "string" }, frames: { type: "number" }, frame: { type: "number" }, output: { type: "string" } } },
    options: [
      { name: "frame", flags: "-f, --frame <number>", description: "Single frame number to export", type: "number", bounds: { min: 0 }, default: 0 },
      { name: "range", flags: "-r, --range <range>", description: "Frame range to export (e.g. 0-60)", type: "string", default: undefined },
      { name: "out", flags: "-o, --out <path>", description: "Output directory or file path", type: "path", default: "./dist/svg" },
      { name: "viewBoxPrecision", flags: "--viewBox-precision <digits>", description: "Coordinate precision digits", type: "number", bounds: { min: 0, max: 10 }, default: 3 },
      { name: "optimize", flags: "--optimize", description: "Run SVGO optimization passes", type: "boolean", default: false },
      { name: "composition", flags: "-c, --composition <name>", description: "Composition name", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./export-svg.js")).exportSvgCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "story",
    summary: "Generate a standalone web player bundle",
    category: "resource",
    outcome: "artifact",
    kind: "write",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["cinecode.config.ts", "source composition"],
      writes: ["storyboard image files"],
    },
    usage: "[entry]",
    examples: ["cinecode story ./main.ts"],
    machineResult: { type: "object", properties: { bundle: { type: "string" }, composition: { type: "string" }, html: { type: "string" }, frames: { type: "array" }, slides: { type: "array" } } },
    options: [
      { name: "out", flags: "-o, --out <dir>", description: "Output directory for web bundle", type: "path", default: "./dist/story" },
      { name: "title", flags: "--title <title>", description: "Story title", type: "string", default: "Cinecode Review" },
      { name: "board", flags: "--board <path>", description: "Storyboard JSON path (auto-detects ./storyboard.json)", type: "path", default: undefined },
    ],
    loadAction: async () => (await import("./story.js")).storyCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "tts",
    summary: "Text-to-speech voice utilities",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["text input", "cinecode.config.ts", "tts models"],
      writes: ["output audio file"],
    },
    usage: "[subcommand]",
    examples: ["cinecode tts voices"],
    machineResult: { type: "object", properties: { voices: { type: "array" }, language: { type: "string" }, provider: { type: "string" }, generated: { type: "string" } } },
    options: [
      { name: "listVoices", flags: "--list-voices", description: "List available voices", type: "boolean", default: false },
      { name: "language", flags: "--language <code>", description: "Filter voices by language or locale", type: "string", default: undefined },
      { name: "search", flags: "--search <text>", description: "Search voice names, locales and styles", type: "string", default: undefined },
      { name: "provider", flags: "--provider <name>", description: "Filter voices by provider", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./tts.js")).ttsCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "compare",
    summary: "Pixel-diff two compositions",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["source compositions", "cinecode.config.ts"],
      writes: ["diff image file (optional)"],
    },
    usage: "<file-a> <file-b>",
    examples: ["cinecode compare ./a.ts ./b.ts"],
    machineResult: { type: "object", properties: { similarity: { type: "number" }, diff: { type: "string" }, metrics: { type: "object" }, images: { type: "array" }, identical: { type: "boolean" } } },
    options: [
      { name: "frames", flags: "-n, --frames <number>", description: "Frames to compare", type: "number", bounds: { min: 1, max: 10000 }, default: 10 },
      { name: "seed", flags: "--seed <number>", description: "Deterministic seed", type: "number", bounds: { min: 0 }, default: 42 },
      { name: "diff", flags: "--diff <path>", description: "Write a side-by-side diff image of the worst frame", type: "path", default: undefined },
      { name: "compositionA", flags: "--composition-a <name>", description: "Composition name in first file", type: "string", default: undefined },
      { name: "compositionB", flags: "--composition-b <name>", description: "Composition name in second file", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./compare.js")).compareCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "diff",
    summary: "Semantic diff between compositions or revisions",
    category: "resource",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: false,
    requiredProject: false,
    contract: {
      reads: ["source composition files", "git revisions"],
      writes: ["none"],
    },
    usage: "<file-a> <file-b>",
    examples: ["cinecode diff ./a.ts ./b.ts"],
    machineResult: { type: "object", properties: { changes: { type: "array" }, differences: { type: "array" }, equal: { type: "boolean" }, files: { type: "array" }, patch: { type: "string" } } },
    options: [
      { name: "format", flags: "--format <format>", description: "Output format: text or markdown", type: "enum", choices: ["text", "markdown"], default: "text" },
      { name: "sideBySide", flags: "--side-by-side", description: "Display terminal diff side-by-side", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./diff.js")).diffCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },

  // 7 Maintenance Commands (all hidden: true)
  {
    name: "audit",
    summary: "Scan dependencies and assets for licences",
    category: "maintenance",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: ["rendered video file", "ffmpeg binary"],
      writes: ["audit report file (optional)"],
    },
    examples: ["cinecode audit --json"],
    machineResult: {
      type: "object",
      properties: {
        licenses: { type: "array" },
        status: { type: "string" },
        scannedDependencies: { type: "number" },
        scannedAssets: { type: "number" },
        vulnerabilities: { type: "array" },
        issues: { type: "array" },
      },
    },
    options: [
      { name: "allowCopyleft", flags: "--allow-copyleft", description: "Do not fail on copyleft licenses (e.g. GPL, AGPL)", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./audit.js")).auditCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "benchmark",
    summary: "Measure frame time, memory and worker capacity",
    category: "maintenance",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: true,
    projectSelectorRule: "optional",
    contract: {
      reads: ["cinecode.config.ts", "source composition"],
      writes: ["benchmark baseline file (optional)"],
    },
    usage: "[entry]",
    examples: ["cinecode benchmark ./composition.ts"],
    machineResult: {
      type: "object",
      properties: {
        fps: { type: "number" },
        frameTimeMs: { type: "number" },
        frames: { type: "number" },
        averageMs: { type: "number" },
        peakMemoryMb: { type: "number" },
        workers: { type: "number" },
        totalMs: { type: "number" },
        minMs: { type: "number" },
        p95Ms: { type: "number" },
        maxMs: { type: "number" },
        comparison: { type: "object" },
      },
    },
    options: [
      { name: "compositionName", flags: "-c, --composition-name <name>", description: "Composition name", type: "string", default: undefined },
      { name: "frames", flags: "-n, --frames <number>", description: "Frames per run", type: "number", bounds: { min: 1, max: 100000 }, default: 60 },
      { name: "runs", flags: "--runs <number>", description: "Number of runs", type: "number", bounds: { min: 1, max: 100 }, default: 3 },
      { name: "seed", flags: "--seed <number>", description: "Deterministic seed", type: "number", bounds: { min: 0 }, default: 42 },
      { name: "compareBaseline", flags: "--compare-baseline", description: "Compare results against historical baseline", type: "boolean", default: false },
      { name: "failOnRegression", flags: "--fail-on-regression", description: "Exit with error code 1 if performance regresses > 5%", type: "boolean", default: false },
      { name: "saveBaseline", flags: "--save-baseline", description: "Save this benchmark run as official baseline", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./benchmark.js")).benchmarkCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "migrate",
    summary: "Migrate the config schema to the latest version",
    category: "maintenance",
    outcome: "artifact",
    kind: "destructive",
    network: false,
    destructive: true,
    hidden: true,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: ["cinecode.config.ts"],
      writes: ["migrated config file", "backup file (.bak)"],
    },
    usage: "[configPath]",
    examples: ["cinecode migrate ./cinecode.config.ts"],
    machineResult: { type: "object", properties: { migrated: { type: "boolean" }, output: { type: "string" } } },
    options: [
      { name: "out", flags: "-o, --out <path>", description: "Write migrated config to a new file instead of replacing in-place", type: "path", default: undefined },
      { name: "backup", flags: "--backup", description: "Create a backup file (.bak) before modifying", type: "boolean", default: false },
      { name: "yes", flags: "-y, --yes", description: "Skip interactive confirmation prompt for in-place migration", type: "boolean", default: false },
      { name: "dryRun", flags: "--dry-run", description: "Print migrated config to stdout without modifying files", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./migrate.js")).migrateCommand as unknown as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "check-ignore",
    summary: "Check paths against .cinecodeignore rules",
    category: "maintenance",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: true,
    projectSelectorRule: "none",
    contract: {
      reads: [".cinecodeignore", "target paths"],
      writes: ["none"],
    },
    usage: "<paths...>",
    examples: ["cinecode check-ignore ./output/intro.mp4"],
    machineResult: { type: "object", properties: { ignored: { type: "array" }, included: { type: "array" }, paths: { type: "array" } } },
    options: [],
    loadAction: async () => (await import("./check-ignore.js")).checkIgnoreCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "alias",
    summary: "Manage shorthand CLI command aliases",
    category: "maintenance",
    outcome: "report",
    kind: "read",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: [".cinecode/profiles.json", "cinecode.config.ts"],
      writes: [".cinecode/profiles.json"],
    },
    usage: "<action> [name] [expansion...]",
    examples: ["cinecode alias list"],
    machineResult: { type: "object", properties: { aliases: { type: "array" }, name: { type: "string" }, expansion: { type: "string" }, action: { type: "string" } } },
    options: [],
    loadAction: async () => (await import("./alias.js")).aliasCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "publish",
    summary: "Publish a rendered output to a destination",
    category: "maintenance",
    outcome: "artifact",
    kind: "write",
    network: false,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: ["rendered output file"],
      writes: ["destination directory"],
    },
    usage: "<file>",
    examples: ["cinecode publish ./output/videos/intro.mp4"],
    machineResult: { type: "object", properties: { published: { type: "boolean" }, destination: { type: "string" }, success: { type: "boolean" }, target: { type: "string" }, message: { type: "string" }, url: { type: "string" } } },
    options: [
      { name: "dest", flags: "-d, --dest <dir>", description: "Local destination directory", type: "path", default: undefined },
      { name: "tag", flags: "--tag <tag>", description: "Tag or release identifier", type: "string", default: undefined },
    ],
    loadAction: async () => (await import("./publish.js")).publishCommand as unknown as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },
  {
    name: "upgrade",
    summary: "Compare the installed version with npm",
    category: "maintenance",
    outcome: "report",
    kind: "network",
    network: true,
    destructive: false,
    hidden: true,
    requiredProject: false,
    contract: {
      reads: ["package.json", "npm registry"],
      writes: ["package.json", "node_modules"],
    },
    examples: ["cinecode upgrade"],
    machineResult: {
      type: "object",
      properties: {
        current: { type: "string" },
        latest: { type: "string" },
        currentVersion: { type: "string" },
        latestVersion: { type: "string" },
        upToDate: { type: "boolean" },
        changelogUrl: { type: "string" },
        breakingChanges: { type: "array" },
      },
    },
    options: [
      { name: "confirm", flags: "--confirm", description: "Explicitly allow the npm network request", type: "boolean", default: false },
    ],
    loadAction: async () => (await import("./upgrade.js")).upgradeCommand as CommandActionFunction,
    load: async function () { return buildCommanderCommand(this); },
  },

  // 3 Informational Commands (all hidden: true)
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
      const action: CommandActionFunction = (optionsOrCmd?: unknown, maybeOptions?: unknown) => {
        const options = (typeof optionsOrCmd === "object" && optionsOrCmd !== null ? optionsOrCmd : maybeOptions ?? {}) as Record<string, unknown>;
        const commandName = typeof optionsOrCmd === "string" ? optionsOrCmd : undefined;
        if (commandName) {
          const target = findCommand(commandName);
          if (target) {
            const cmd = buildCommanderCommand(target);
            cmd.outputHelp();
            return;
          }
        }
        runReport.writeRawStdout(`${formatHelpText(options.all === true)}\n`);
      };
      return action;
    },
    load: async function () { return buildCommanderCommand(this); },
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
    load: async function () { return buildCommanderCommand(this); },
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
    load: async function () { return buildCommanderCommand(this); },
  },
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
    const { loadAction, load, ...rest } = cmd;
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
