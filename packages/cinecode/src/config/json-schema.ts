import { z } from "zod";
import { CinecodeConfigInputSchema } from "./zod-schema.js";

export type JsonSchemaNode = Readonly<Record<string, unknown>>;
export type JsonSchemaDocument = JsonSchemaNode & {
  readonly $schema: string;
  readonly $id: string;
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
    $id: "https://cinecode.dev/schemas/cinecode.schema.json",
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
    "| `images[].file` | string | — | Isolated image definition file under `src/` | no |",
    "| `images[].width` | number | — | Width in pixels | no |",
    "| `images[].height` | number | — | Height in pixels | no |",
    "| `images[].format` | \"png\" \\| \"jpg\" \\| \"webp\" \\| \"svg\" | `\"png\"`, `\"jpg\"`, `\"webp\"`, `\"svg\"` | Output still format | no |",
    "| `images[].quality` | number | 0–100 | Quality for lossy formats | no |",
    "| `images[].scaleFactor` | number | — | Multiplier for HiDPI/Retina exports | no |",
    "| `audio[]` | array<AudioEntry> | — | Audio beds and synthesized tracks | no |",
    "| `audio[].id` | string | — | Unique identifier referenced by timelines | yes |",
    "| `audio[].name` | string | — | Human-readable label | no |",
    "| `audio[].file` | string | — | Isolated audio definition file under `src/` | no |",
    "| `audio[].kind` | \"voice\" \\| \"music\" \\| \"sfx\" \\| \"other\" | `\"voice\"`, `\"music\"`, `\"sfx\"`, `\"other\"` | Category of audio asset | no |",
    "| `audio[].sampleRate` | number | 22050, 44100, 48000, 96000 | Audio sample rate in Hz | no |",
    "| `audio[].channels` | 1 \\| 2 | `1`, `2` | Channel layout (mono or stereo) | no |",
    "| `audio[].gain` | number | — | Base gain multiplier | no |",
    "| `audio[].duration` | number \\| string | — | Duration in seconds or timecode | no |",
    "| `scenes[]` | array<SceneEntry> | — | Visual scenes composed of tracks | no |",
    "| `scenes[].id` | string | — | Unique identifier referenced by timelines | yes |",
    "| `scenes[].name` | string | — | Human-readable label | no |",
    "| `scenes[].file` | string | — | Isolated scene definition file under `src/` | no |",
    "| `scenes[].duration` | number \\| string | — | Scene duration in seconds or timecode | no |",
    "| `timelines[]` | array<TimelineEntry> | — | Top-level renderable compositions | no |",
    "| `timelines[].id` | string | — | Unique timeline identifier (e.g. \"main\") | yes |",
    "| `timelines[].name` | string | — | Human-readable title | no |",
    "| `timelines[].duration` | number \\| string | — | Duration in seconds or timecode | no |",
    "| `timelines[].sceneRefs` | array<string> | — | Array of scene IDs in playback order | no |",
    "| `timelines[].audioRef` | array<string> | — | Array of audio IDs mixed into timeline | no |",
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
    "| Key | Type | Values | Required |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
