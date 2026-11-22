import { z } from "zod";
import { CinecodeConfigInputSchema } from "./zod-schema.js";

export type JsonSchemaNode = Readonly<Record<string, unknown>>;
export type JsonSchemaDocument = JsonSchemaNode & {
  readonly $schema: string;
  readonly $id?: string;
  readonly title: string;
  readonly description: string;
};

export interface SchemaField {
  readonly path: string;
  readonly type: string;
  readonly values: readonly string[];
  readonly required: boolean;
}

export function generateSchema(): JsonSchemaDocument {
  const generated = z.toJSONSchema(CinecodeConfigInputSchema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  return {
    ...generated,
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Cinecode Configuration",
    description: "JSON Schema for Cinecode configs, generated from the runtime Zod schema.",
  };
}

export function generateSchemaJson(): string {
  return `${JSON.stringify(generateSchema(), null, 2)}\n`;
}

function branchesOf(node: JsonSchemaNode): JsonSchemaNode[] {
  const unions = [node.anyOf, node.oneOf].flatMap((branch) => (Array.isArray(branch) ? (branch as JsonSchemaNode[]) : []));
  return unions.length > 0 ? unions : [node];
}

function typeLabel(node: JsonSchemaNode): string {
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    return [...new Set(branchesOf(node).map(typeLabel))].join(" or ");
  }
  const type = node.type;
  if (Array.isArray(type)) return type.join(" or ");
  if (type === "object" && node.properties) return `object (${Object.keys(node.properties as Record<string, unknown>).join(", ")})`;
  if (type === "array" && node.items) return `array<${typeLabel(node.items as JsonSchemaNode)}>`;
  if (type === "string" && typeof node.pattern === "string") return "string (pattern)";
  return type === undefined ? "any" : String(type);
}

function valuesOf(node: JsonSchemaNode): string[] {
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value));
  if ("const" in node) return [JSON.stringify(node.const)];
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    return [...new Set(branchesOf(node).flatMap(valuesOf))];
  }
  return [];
}

/** Every field path an authoring document can contain, including array items. */
export function collectSchemaFields(): SchemaField[] {
  const rows = new Map<string, { types: Set<string>; values: Set<string>; required: boolean }>();
  const add = (path: string, node: JsonSchemaNode, required: boolean): void => {
    const row = rows.get(path) ?? { types: new Set<string>(), values: new Set<string>(), required: false };
    row.types.add(typeLabel(node));
    for (const value of valuesOf(node)) row.values.add(value);
    row.required ||= required;
    rows.set(path, row);
  };
  const walk = (node: JsonSchemaNode, prefix: string, required: ReadonlySet<string>): void => {
    for (const object of branchesOf(node).filter((branch) => branch.properties)) {
      const objectRequired = new Set((object.required as readonly string[] | undefined) ?? []);
      for (const [key, child] of Object.entries(object.properties as Record<string, JsonSchemaNode>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        add(path, child, required.has(key));
        walk(child, path, objectRequired);
      }
    }
    if (node.type === "array" && node.items) {
      const items = node.items as JsonSchemaNode;
      const itemPath = `${prefix}[]`;
      if (branchesOf(items).some((branch) => branch.properties)) add(itemPath, items, false);
      walk(items, itemPath, new Set((items.required as readonly string[] | undefined) ?? []));
    }
  };
  walk(generateSchema(), "", new Set());
  return [...rows].map(([path, row]) => ({
    path,
    type: [...row.types].join(" or "),
    values: [...row.values],
    required: row.required,
  }));
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function generateManifestReferenceMarkdown(): string {
  const manifestRows = [
    "# Manifest reference (`main.ts`)",
    "",
    "Every root manifest exports `defineMain({ ... })`. Each asset references an isolated source file under `src/`.",
    "",
    "| Key | Type | Values | Description | Required |",
    "| --- | --- | --- | --- | --- |",
    "| `images[]` | array<ImageEntry> | — | Standalone still images | no |",
    "| `images[].id` | string | — | Unique identifier referenced by CLI generate | yes |",
    "| `images[].name` | string | — | Human-readable label | no |",
    "| `images[].file` | string | — | Isolated image definition file under `src/` | yes |",
    "| `images[].width` | number | — | Width in pixels | no |",
    "| `images[].height` | number | — | Height in pixels | no |",
    "| `images[].format` | \"png\" \\| \"jpg\" \\| \"webp\" | `\"png\"`, `\"jpg\"`, `\"webp\"` | Raster output format; vectors use `export-svg` | no |",
    "| `images[].quality` | number | 0–100 | Quality for lossy formats | no |",
    "| `images[].scaleFactor` | number | — | Multiplier for HiDPI/Retina exports | no |",
    "| `images[].background` | string | — | Background colour for the still | no |",
    "| `images[].seed` | number | — | Deterministic seed for procedural images | no |",
    "| `audio[]` | array<AudioEntry> | — | Audio beds and synthesized tracks | no |",
    "| `audio[].id` | string | — | Unique identifier referenced by timelines | yes |",
    "| `audio[].name` | string | — | Human-readable label | no |",
    "| `audio[].file` | string | — | Isolated audio definition file under `src/` | one of `file` or `src` |",
    "| `audio[].src` | string | — | Audio file inside the media root | one of `file` or `src` |",
    "| `audio[].sampleRate` | number | 22050, 44100, 48000, 96000 | Audio sample rate in Hz | no |",
    "| `audio[].channels` | 1 \\| 2 | `1`, `2` | Channel layout (mono or stereo) | no |",
    "| `audio[].gain` | number | 0–4 linear (silent to +12 dB) | Placement gain; values outside the range are rejected | no |",
    "| `audio[].duration` | number \\| string | — | Duration in seconds or timecode | no |",
    "| `scenes[]` | array<SceneEntry> | — | Visual scenes composed of tracks | no |",
    "| `scenes[].id` | string | — | Unique identifier referenced by timelines | yes |",
    "| `scenes[].name` | string | — | Human-readable label | no |",
    "| `scenes[].file` | string | — | Isolated scene definition file under `src/` | yes |",
    "| `scenes[].duration` | number \\| string | — | Scene duration in seconds or timecode; must match the content | no |",
    "| `scenes[].truncate` | boolean | — | Accept a shorter declared duration and report dropped frames | no |",
    "| `scenes[].width` | number | — | Scene width override | no |",
    "| `scenes[].height` | number | — | Scene height override | no |",
    "| `scenes[].fps` | number | — | Scene frame rate override | no |",
    "| `scenes[].background` | string | — | Scene background colour | no |",
    "| `timelines[]` | array<TimelineEntry> | — | Top-level renderable compositions | no |",
    "| `timelines[].id` | string | — | Unique timeline identifier (e.g. \"main\") | yes |",
    "| `timelines[].name` | string | — | Human-readable title | no |",
    "| `timelines[].file` | string | — | Isolated timeline definition file under `src/` | one of `file` or `sceneRefs` |",
    "| `timelines[].sceneRefs` | array<string> | — | Scene IDs played back to back in array order | one of `file` or `sceneRefs` |",
    "| `timelines[].audioRef` | array<string> | — | Audio beds mixed into the timeline | no |",
    "| `timelines[].duration` | number \\| string | — | Duration in seconds or timecode; must fit the content | no |",
    "| `timelines[].truncate` | boolean | — | Accept a shorter declared duration and report dropped frames | no |",
    "| `timelines[].width` | number | — | Timeline width override | no |",
    "| `timelines[].height` | number | — | Timeline height override | no |",
    "| `timelines[].fps` | number | — | Timeline frame rate override | no |",
    "| `timelines[].background` | string | — | Timeline background colour | no |",
    "| `timelines[].format` | string | see [output formats](./output-formats.md) | Render output format override | no |",
    "| `timelines[].codec` | string | see [output formats](./output-formats.md) | Video codec override | no |",
    "| `timelines[].quality` | string | `draft`, `preview`, `medium`, `final`, `lossless`, `low`, `high` | Quality preset override | no |",
    "",
    "## Duration and truncation",
    "",
    "A declared `duration` never truncates content silently. If the resolved content is longer",
    "than the declaration by more than one frame, validation fails with `CC1010`, naming the",
    "declared duration, the content duration and the frames that would be lost. Add",
    '`truncate: true` to accept the cut: the run records a degradation that reports the frame',
    "count. A declared duration longer than the content is allowed; the trailing time uses the",
    "boundary mode and the run reports an informational note, not a warning.",
    "",
    "## Scene sequencing",
    "",
    "A timeline compiles either its `file` or its `sceneRefs`, never both. Scenes referenced by",
    "`sceneRefs` play back to back in array order, with no implicit overlap and no implicit",
    "transition. Each scene occupies exactly its resolved content duration; a declared scene",
    "`duration` that differs from that content by more than one frame is an error, not an",
    "overlap into the next scene. Build a cross-scene transition inside one scene file.",
    "",
    "## Audio placement",
    "",
    "Every registered audio asset referenced by `audioRef` is a bed: it starts at `0` and spans",
    "the whole timeline duration. The manifest has no per-entry offset. `gain` is linear (`0`",
    "silent, `1` unity, up to `4` / +12 dB) and is applied as the placement volume. Supported",
    "sample rates are 22050, 44100, 48000, 96000 Hz; channel count is 1 (mono) or 2 (stereo).",
    "Longer audio sources are trimmed to the bed duration; shorter sources are padded with silence",
    "(no time stretching). Generated audio is always written as WAV; `audio[].format` does not exist.",
    "A missing audio `src` is a validation error that names the entry and the searched path before any",
    "decode starts.",
    "",
    "## Sequence and track builders",
    "",
    "Sequences start at `start` seconds (defaults to 0). The first clip's `transitionIn` overlaps the",
    "sequence head without producing a negative start time. Subsequent clips chain from the previous",
    "clip end minus the incoming transition overlap. Tracks support `name`, `muted`, `opacity` (0–1),",
    "and `blend`. Unsupported builder options fail at construction with `CC1014`.",
    "",
    "## Timing and keyframe rules",
    "",
    "`start` is composition time in seconds. When both `duration` and `end` are present on a clip,",
    "`duration` wins. Negative time values are rejected at validation. Keyframe times are",
    "clip-relative seconds, clamped to non-negative times. Transitions are validated against the",
    "builtin transition registry at construction.",
    "",
    "## Output naming and preview quality",
    "",
    "Output filenames derive from the target identifier and container extension defined in the",
    "output plan. When rendering with `--preview` or `--quality preview`, a `.preview` suffix is",
    "appended before the container extension (e.g. `main.preview.mp4`). Output paths are deterministic:",
    "the same project, selection, and render options produce identical filenames with no timestamps.",
  ];
  return manifestRows.join("\n");
}

export function generateReferenceMarkdown(): string {
  const rows = collectSchemaFields().map(
    (field) =>
      `| \`${field.path}\` | ${cell(field.type)} | ${field.values.length > 0 ? cell(field.values.map((value) => `\`${value}\``).join(", ")) : "—"} | ${field.required ? "yes" : "no"} |`,
  );

  return [
    "# Configuration reference",
    "",
    "Generated from the runtime schema in `packages/cinecode/src/config/zod-schema.ts`.",
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
    "| Key | Type | Values | Required |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
