import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const docsDir = join(root, "docs");

const isCheck = process.argv.includes("--check");

// Load runtime metadata
const { COMMANDS } = await import("../packages/cinecode/dist/esm/cli/command-registry.js");
const { collectSchemaFields, generateManifestReferenceMarkdown } = await import(
  "../packages/cinecode/dist/esm/config/json-schema.js"
);
const { DEFAULTS } = await import("../packages/cinecode/dist/esm/config/defaults.js");
const { OUTPUT_PLANS } = await import("../packages/cinecode/dist/esm/core/output-plan.js");
const { formatsReferenceMarkdown } = await import("../packages/cinecode/dist/esm/media/formats.js");
const { ErrorCode, ErrorMessages, FIX_HINTS } = await import("../packages/cinecode/dist/esm/errors/index.js");
const { exitCodeForError } = await import("../packages/cinecode/dist/esm/cli/exit-codes.js");

function cell(val) {
  return String(val ?? "—").replace(/\|/g, "\\|");
}

function getDefaultValue(path, defaults) {
  const parts = path.replace(/\[\]/g, "").split(".");
  let curr = defaults;
  for (const part of parts) {
    if (curr === undefined || curr === null || typeof curr !== "object") return undefined;
    curr = curr[part];
  }
  return curr;
}

// 1. Command Reference
export function generateCommandReference() {
  const lines = [
    "# CLI Command Reference",
    "",
    "<!-- Generated automatically from CLI command metadata. Do not edit manually. -->",
    "",
    `Cinecode provides ${COMMANDS.length} canonical CLI commands for project authoring, diagnostics, rendering, and asset generation.`,
    "",
    "Informational commands (`help`, `version`, `licence`) print text on standard output only, write nothing on standard error, exit `0` and never emit the machine envelope.",
    "",
    "A project entry file (`main.ts`) has exactly one accepted shape: `export default defineMain({ images, audio, scenes, timelines })`. A composition, timeline, scene, image or audio definition in `main.ts` is a contract error; definitions belong in the entry files the manifest references.",
    "",
    "## Commands Overview",
    "",
    "| Command | Category | Summary | Example |",
    "| --- | --- | --- | --- |",
  ];

  for (const cmd of COMMANDS) {
    const example = cmd.examples && cmd.examples.length > 0 ? `\`${cmd.examples[0]}\`` : "—";
    lines.push(`| [\`cinecode ${cmd.name}\`](#${cmd.name}) | \`${cmd.category}\` | ${cell(cmd.summary)} | ${cell(example)} |`);
  }

  lines.push("", "## Command Details", "");

  for (const cmd of COMMANDS) {
    lines.push(
      `### \`cinecode ${cmd.name}\` {#${cmd.name}}`,
      "",
      cmd.summary,
      "",
      `- **Category:** \`${cmd.category}\``,
      `- **Kind:** \`${cmd.kind}\``,
      `- **Surface Contract:** Reads: \`[${cmd.contract.reads.join(", ") || "none"}]\`, Writes: \`[${cmd.contract.writes.join(", ") || "none"}]\``,
      `- **Requires Project:** \`${cmd.requiredProject ? "yes" : "no"}\`${cmd.projectSelectorRule ? ` (Selector: \`${cmd.projectSelectorRule}\`)` : ""}`,
    );
    if (cmd.aliases && cmd.aliases.length > 0) {
      lines.push(`- **Aliases:** \`${cmd.aliases.join("`, `")}\``);
    }
    lines.push("", "#### Options", "", "| Flag | Type | Default | Description | Bounds / Choices |", "| --- | --- | --- | --- | --- |");

    const visibleOptions = (cmd.options || []).filter((opt) => !opt.hidden);
    if (visibleOptions.length === 0) {
      lines.push("| — | — | — | No command-specific options | — |");
    } else {
      for (const opt of visibleOptions) {
        const boundsOrChoices = opt.choices
          ? opt.choices.map((c) => `\`${c}\``).join(", ")
          : opt.bounds
            ? `[${opt.bounds.min ?? "-∞"}..${opt.bounds.max ?? "+∞"}]`
            : "—";
        const def = opt.default !== undefined ? `\`${JSON.stringify(opt.default)}\`` : "—";
        lines.push(`| \`${opt.flags}\` | \`${opt.type}\` | ${def} | ${cell(opt.description)} | ${boundsOrChoices} |`);
      }
    }

    if (cmd.examples && cmd.examples.length > 0) {
      lines.push("", "#### Examples", "", "```bash", cmd.examples.join("\n"), "```", "");
    } else {
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

// 2. Config Reference
export function generateConfigReference() {
  const fields = collectSchemaFields();
  const rows = fields.map((field) => {
    const def = getDefaultValue(field.path, DEFAULTS);
    const defStr = def !== undefined ? `\`${JSON.stringify(def)}\`` : "—";
    const valStr = field.values.length > 0 ? field.values.map((v) => `\`${v}\``).join(", ") : "—";
    return `| \`${field.path}\` | ${cell(field.type)} | ${cell(valStr)} | ${defStr} | ${field.required ? "yes" : "no"} |`;
  });

  return [
    "# Configuration reference",
    "",
    "<!-- Generated automatically from config schema and defaults table. Do not edit manually. -->",
    "",
    "Generated from the runtime schema in `packages/cinecode/src/config/zod-schema.ts` and `defaults.ts`.",
    "Unknown keys are rejected at every level. Array item fields use `[]`.",
    "For manifest documentation, see [manifest-reference.md](./manifest-reference.md).",
    "",
    "## Project roots and media policy",
    "",
    "The four project roots (`sourceDir`, `mediaDir`, `outputDir`, and `cacheDir`) must resolve to",
    "distinct, non-overlapping paths. None can be the project root or parent of another. Media",
    "(`mediaDir`) is strictly read-only except for the opt-in `cinecode media:download` command.",
    "Media references are resolved against `mediaDir` and cannot escape via `..` or symlinks.",
    "Co-located media under `sourceDir` is supported only when `allowCoLocatedMedia: true` is configured.",
    "",
    "| Key | Type | Values | Default | Required |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

// 3. Manifest Reference
export function generateManifestReference() {
  return generateManifestReferenceMarkdown().trimEnd() + "\n";
}

// 4. Output Formats
export function generateOutputFormats() {
  return formatsReferenceMarkdown().trimEnd() + "\n";
}

// 5. Support Matrix
export function generateSupportMatrix() {
  const formatRows = Object.values(OUTPUT_PLANS).map((p) => {
    const defaultCodec = p.defaultCodec ?? (p.codecs && p.codecs[0]) ?? "—";
    const alpha = p.alpha ? `**Yes** (${p.alphaPixFmt || p.pixFmt})` : "No";
    const audio = p.audio ? `${p.audio.defaultCodec}` : "No audio";
    const ext = p.extension || "—";
    return `| \`${p.format}\` | \`${p.container}\` (${ext}) | \`${defaultCodec}\` | ${alpha} | ${audio} | ${ext} |`;
  });

  return [
    "# Support Matrix and Operational Limits",
    "",
    "<!-- Generated automatically from runtime constants. Do not edit manually. -->",
    "",
    "This document specifies the supported execution environments, formats, codecs, audio constraints, fonts, and explicit boundaries for Cinecode. Every statement is verified by automated test suites.",
    "",
    "## Bundled FFmpeg and FFprobe",
    "",
    "Cinecode ships the platform FFmpeg and FFprobe installer packages with the framework.",
    "Resolution order: `CINECODE_FFMPEG_PATH` or `CINECODE_FFPROBE_PATH`, project `binaries.ffmpegPath` or `binaries.ffprobePath`, bundled installer package, then system `PATH`.",
    "The resolved absolute path, version and provenance are reported by `cinecode doctor`.",
    "",
    "LGPL licence notices ship in `THIRD_PARTY_NOTICES.md`. The full binary build provenance is provided by each platform installer package.",
    "",
    "## Supported Environments",
    "",
    "| Environment | Requirement | Notes |",
    "| --- | --- | --- |",
    "| **Node.js** | `>=22.18.0` | Node 22 LTS or Node 24. Older versions are rejected on boot with exit code `78` (`CINECODE_RUNTIME_UNSUPPORTED`). |",
    "| **Operating Systems** | Windows (x64/arm64), macOS (Apple Silicon/Intel), Linux (x64) | Tested on Windows 11 and Ubuntu LTS in CI. |",
    "| **Architecture** | Native ESM only | CommonJS `require()` is rejected per package policy (`ERR_PACKAGE_PATH_NOT_EXPORTED`). |",
    "| **TypeScript Contract** | Native type stripping / erasable syntax | Standard type annotations, interfaces, type aliases. No runtime TypeScript compilation or non-erasable constructs (enums, namespaces). |",
    "",
    "## Formats and Alpha Channel Support",
    "",
    "| Format | Container | Default Video Codec | Alpha Transparency Support | Audio Support | Extension |",
    "| --- | --- | --- | --- | --- | --- |",
    ...formatRows,
    "",
    "## Audio Constraints",
    "",
    "- **Sample Rates:** `22050`, `44100`, `48000`, `96000` Hz.",
    "- **Channel Layouts:** Mono (`1` channel), Stereo (`2` channels), 5.1 Surround (`6` channels).",
    "- **Internal Precision:** 32-bit floating point PCM audio mixing in fixed 4096-frame blocks.",
    "- **Output Bit Depth:** 16-bit or 24-bit lossless PCM.",
    "- **Limiter:** Lookahead peak limiter with 1 ms lookahead, 100 ms release, -0.05 dBFS ceiling clamp.",
    "- **No-audio optimization:** When audio peak is below -60 dBFS and `--force-audio` is unset, output video is produced without unnecessary empty audio tracks.",
    "",
    "## Font Support",
    "",
    "- **Supported Font Types:** OpenType (`.otf`), TrueType (`.ttf`), WOFF2 (`.woff2`).",
    "",
  ].join("\n");
}

// 6. Error Codes Reference
export function generateErrorCodes() {
  const sortedCodes = Object.keys(ErrorCode).sort();
  const rows = sortedCodes.map((code) => {
    const exitCode = exitCodeForError(code);
    const msg = ErrorMessages[code] ?? "";
    const fix = FIX_HINTS[code] ?? "";
    return `| \`${code}\` | \`${exitCode}\` | ${cell(msg)} | ${cell(fix)} |`;
  });

  return [
    "# Error Code Reference",
    "",
    "<!-- Generated automatically from error codes enum and exit mappings. Do not edit manually. -->",
    "",
    "All Cinecode errors use coded identifiers (`CCxxxx`), actionable remediation hints, and deterministic process exit codes.",
    "",
    "| Code | Exit Code | Message Template | Remediation / Fix Hint |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

// 7. Machine Output Document
export function generateMachineOutput() {
  const resultShapeLines = [];
  for (const cmd of COMMANDS) {
    const props = cmd.machineResult?.properties ? Object.keys(cmd.machineResult.properties).join(", ") : "none";
    resultShapeLines.push(`| \`cinecode ${cmd.name}\` | \`${cmd.machineResult?.type ?? "object"}\` | ${cell(props)} |`);
  }

  return [
    "# Machine output contract",
    "",
    "<!-- Generated automatically from machine envelope contract and registry metadata. Do not edit manually. -->",
    "",
    "Every CLI command supports one switch, `--json`. In machine mode stdout carries",
    "exactly one well-formed JSON document and nothing else. Human text, progress",
    "and structured logs go to stderr.",
    "",
    "Informational commands (`help`, `version`, `licence`) are the single exception:",
    "they print plain text on stdout, write nothing on stderr, exit `0` and never",
    "emit the envelope, with or without `--json`. Help and version are clean exits,",
    "not reports.",
    "",
    "Schema version: `1` (`MACHINE_SCHEMA_VERSION` in the CLI package).",
    "",
    "```json",
    "{",
    '  "schemaVersion": 1,',
    '  "command": "render",',
    '  "ok": true,',
    '  "exitCode": 0,',
    '  "degraded": false,',
    '  "timing": { "startedAt": "2026-11-22T00:00:00.000Z", "durationMs": 1250 },',
    '  "project": {',
    '    "root": "/project",',
    '    "config": "/project/cinecode.config.ts",',
    '    "manifest": "/project/main.ts"',
    "  },",
    '  "selection": [{ "id": "hero", "name": "Hero", "kind": "timeline", "width": 1920, "height": 1080, "fps": 30, "duration": 10 }],',
    '  "result": {},',
    '  "artifacts": [',
    '    { "kind": "video", "path": "/project/output/videos/hero.mp4", "units": 300, "unit": "frames" }',
    "  ],",
    '  "warnings": [],',
    '  "degradations": [],',
    '  "issues": [],',
    '  "resourceUsage": {',
    '    "memoryRssMb": 85,',
    '    "wallClockMs": 1250,',
    '    "processSpawns": 3,',
    '    "framesDecoded": 120,',
    '    "framesFromCache": 0,',
    '    "bytesTransferred": 248832000',
    "  },",
    '  "explain": null,',
    '  "descriptor": null',
    "}",
    "```",
    "",
    "## Envelope Fields",
    "",
    "| Field | Type | Meaning |",
    "| --- | --- | --- |",
    "| `schemaVersion` | `1` | Schema version constant. |",
    "| `command` | `string` | Resolved command name after alias expansion. |",
    "| `ok` | `boolean` | `true` if command completed without unhandled errors; `false` on failure. |",
    "| `exitCode` | `number` | Deterministic process exit code (`0`, `1`, `2`, `3`, `4`, `78`, `130`). |",
    "| `degraded` | `boolean` | `true` when recoverable substitutions or degradation events occurred. |",
    "| `timing` | `object` | Start timestamp (`startedAt`) and total elapsed time (`durationMs`). |",
    "| `project` | `object \| null` | Resolved paths for `root`, `config`, and `manifest` (null if standalone). |",
    "| `selection` | `array \| null` | Summary of resolved target timelines, scenes, or compositions. |",
    "| `result` | `object` | Typed per-command payload matching the declared command result shape. |",
    "| `artifacts` | `array` | Produced artifact records (path, kind, units, unit, sha256). |",
    "| `warnings` | `array` | Non-fatal diagnostic warning records (`code`, `message`, `input`). |",
    "| `degradations` | `array` | Recorded graceful degradations (`code`, `what`, `reason`, `instead`). |",
    "| `issues` | `array` | Validation or execution issues encountered during run. |",
    "| `resourceUsage` | `object \| null` | Runtime telemetry (`memoryRssMb`, `processSpawns`, `framesDecoded`, `bytesTransferred`). |",
    "| `explain` | `object \| null` | Resolved execution plan, parameter origins, and resource plan when requested. |",
    "| `descriptor` | `object \| null` | Command descriptor metadata (options, flags, contracts). |",
    "| `error` | `object` | Only on failure: coded error record (`code`, `message`, `fixHint`, `issues`). |",
    "",
    "## Per-Command Result Shapes",
    "",
    "| Command | Result Shape Type | Declared Properties |",
    "| --- | --- | --- |",
    ...resultShapeLines,
    "",
  ].join("\n");
}

const GENERATORS = [
  { file: join(docsDir, "command-reference.md"), generate: generateCommandReference },
  { file: join(docsDir, "config-reference.md"), generate: generateConfigReference },
  { file: join(docsDir, "manifest-reference.md"), generate: generateManifestReference },
  { file: join(docsDir, "output-formats.md"), generate: generateOutputFormats },
  { file: join(docsDir, "support-matrix.md"), generate: generateSupportMatrix },
  { file: join(docsDir, "error-codes.md"), generate: generateErrorCodes },
  { file: join(docsDir, "machine-output.md"), generate: generateMachineOutput },
];

export function runGeneration(checkOnly = false) {
  let driftCount = 0;
  for (const { file, generate } of GENERATORS) {
    const expected = generate();
    if (checkOnly) {
      if (!existsSync(file)) {
        console.error(`[DRIFT] File missing: ${file}`);
        driftCount++;
        continue;
      }
      const current = readFileSync(file, "utf8");
      if (current.trim() !== expected.trim()) {
        console.error(`[DRIFT] Document differs from runtime constants: ${file}`);
        driftCount++;
      }
    } else {
      writeFileSync(file, expected, "utf8");
      console.log(`Updated: ${file}`);
    }
  }

  if (checkOnly) {
    if (driftCount > 0) {
      console.error(`\nDocs drift check failed: ${driftCount} document(s) drifted. Run 'node scripts/generate-docs.mjs' to regenerate.`);
      process.exit(1);
    } else {
      console.log(`Docs drift check ok: all ${GENERATORS.length} generated documents in sync with runtime constants.`);
    }
  }
}

const isDirectRun = process.argv[1] && (process.argv[1].endsWith("generate-docs.mjs") || process.argv[1].endsWith("generate-docs"));
if (isDirectRun) {
  runGeneration(isCheck);
}
