import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SCHEMA_VERSIONS,
  validateConfigWithZod,
  validateNormalizedConfigWithZod,
} from "../zod-schema.js";
import { collectSchemaFields, generateReferenceMarkdown, generateSchema, generateSchemaJson } from "../json-schema.js";
import { validateAuthoringConfig, validateConfig, validateNormalizedConfig } from "../validator.js";
import { normalizeConfig } from "../schema.js";
import { ErrorCode } from "../../errors/index.js";

type JsonNode = Record<string, any>;

const schema = generateSchema() as JsonNode;
const fields = collectSchemaFields();
const skipInvalid = new Set(["composition"]);
const PATTERN_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["#", "#000000"],
  ["\\d+x", "1080p"],
];

function branchesOf(node: JsonNode): JsonNode[] {
  const union = node.anyOf ?? node.oneOf;
  return Array.isArray(union) ? (union as JsonNode[]) : [node];
}

function sample(node: JsonNode): unknown {
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) return sample(branchesOf(node)[0]!);
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === "array") return [];
  if (type === "object") {
    const value: Record<string, unknown> = {};
    for (const key of (node.required as string[] | undefined) ?? []) value[key] = sample(node.properties[key]);
    return value;
  }
  if (type === "boolean") return true;
  if (type === "number" || type === "integer") {
    const exclusive = node.exclusiveMinimum as number | undefined;
    const minimum = (node.minimum as number | undefined) ?? 0;
    let value = exclusive !== undefined ? (type === "integer" ? Math.ceil(exclusive + 1) : exclusive + 0.5) : minimum;
    const maximum = node.maximum as number | undefined;
    if (maximum !== undefined && value > maximum) value = maximum;
    return type === "integer" ? Math.round(value) : value;
  }
  if (type === "string") {
    const pattern = node.pattern as string | undefined;
    const known = pattern ? PATTERN_SAMPLES.find(([fragment]) => pattern.includes(fragment)) : undefined;
    if (known) return known[1];
    return node.minLength ? "s".repeat(node.minLength as number) : "sample";
  }
  return null;
}

function fullSample(node: JsonNode): unknown {
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    return fullSample(branchesOf(node).find((branch) => branch.properties) ?? branchesOf(node)[0]!);
  }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === "object" && node.properties) {
    const value: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties as Record<string, JsonNode>)) value[key] = fullSample(child);
    return value;
  }
  return sample(node);
}

function schemaAt(path: string): JsonNode {
  let node: JsonNode = schema;
  for (const segment of path.split(".")) {
    const isItem = segment.endsWith("[]");
    const key = isItem ? segment.slice(0, -2) : segment;
    const object = branchesOf(node).find((branch) => branch.properties?.[key]);
    node = object ? object.properties[key] : {};
    if (isItem && node.items) node = node.items;
  }
  return node;
}

function withPath(base: unknown, path: string, value: unknown): Record<string, unknown> {
  const doc = structuredClone(base) as Record<string, unknown>;
  const segments = path.split(".");
  let target: Record<string, any> = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const isItem = segments[i]!.endsWith("[]");
    const key = isItem ? segments[i]!.slice(0, -2) : segments[i]!;
    if (isItem) {
      target[key] = Array.isArray(target[key]) ? target[key] : [];
      if (target[key].length === 0) target[key].push(fullSample(schemaAt(segments.slice(0, i + 1).join("."))));
      target = target[key][0];
    } else {
      if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
      target = target[key];
    }
  }
  const last = segments[segments.length - 1]!;
  if (last.endsWith("[]")) {
    target[last.slice(0, -2)] = [value];
  } else {
    target[last] = value;
  }
  return doc;
}

function invalidSample(node: JsonNode): unknown {
  if (Array.isArray(node.enum)) return typeof node.enum[0] === "number" ? -1 : "__invalid__";
  if ("const" in node) return "__invalid__";
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const rejected = [12345, "__invalid__", true, [], {}, null].find((candidate) =>
      branchesOf(node).every((branch) => jsonErrors(branch, candidate).length > 0),
    );
    return rejected ?? "__invalid__";
  }
  if (Array.isArray(node.type)) {
    return [true, [], {}, null, "__invalid__", 12345].find((candidate) => (node.type as string[]).every((candidateType) => !typeMatches(candidateType, candidate))) ?? "__invalid__";
  }
  const type = node.type;
  if (type === "string") return 12345;
  if (type === "number" || type === "integer") return "not-a-number";
  if (type === "boolean") return "not-a-boolean";
  if (type === "array") return "not-an-array";
  if (type === "object") return "not-an-object";
  return [true, [], {}, null, "__invalid__", 12345].find((candidate) => !typeMatches(type, candidate)) ?? "__invalid__";
}

function typeMatches(type: string, value: unknown): boolean {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function jsonErrors(node: JsonNode, value: unknown, path = ""): string[] {
  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union)) {
    const results = (union as JsonNode[]).map((branch) => jsonErrors(branch, value, path));
    return results.some((result) => result.length === 0) ? [] : [...new Set(results.flat())];
  }
  const errors: string[] = [];
  if ("const" in node && value !== node.const) errors.push(path);
  if (Array.isArray(node.enum) && !node.enum.includes(value)) errors.push(path);
  const type = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (type.length > 0 && !type.some((candidate: string) => typeMatches(candidate, value))) return [path];
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) errors.push(path);
    if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum) errors.push(path);
    if (typeof node.maximum === "number" && value > node.maximum) errors.push(path);
  }
  if (typeof value === "string") {
    if (typeof node.minLength === "number" && value.length < node.minLength) errors.push(path);
    if (typeof node.pattern === "string" && !new RegExp(node.pattern).test(value)) errors.push(path);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in record)) errors.push(path);
    }
    const properties = (node.properties as Record<string, JsonNode> | undefined) ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) errors.push(...jsonErrors(child, record[key], `${path}/${key}`));
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(record)) if (!(key in properties)) errors.push(`${path}/${key}`);
    } else if (typeof node.additionalProperties === "object") {
      for (const key of Object.keys(record)) if (!(key in properties)) errors.push(...jsonErrors(node.additionalProperties as JsonNode, record[key], `${path}/${key}`));
    }
  }
  if (Array.isArray(value) && node.items) {
    value.forEach((item, index) => errors.push(...jsonErrors(node.items as JsonNode, item, `${path}/${index}`)));
  }
  return errors;
}

function fieldOfJsonPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const field: string[] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      field[field.length - 1] = `${field[field.length - 1]}[]`;
    } else {
      field.push(part);
    }
  }
  return field.join(".");
}

function fieldOfZodPath(path: string): string {
  return path.replace(/\.(\d+)(?=\.|$)/g, "[]");
}

function documentedFields(): Map<string, { type: string; values: string[] }> {
  const rows = new Map<string, { type: string; values: string[] }>();
  for (const line of generateReferenceMarkdown().split("\n")) {
    const match = line.match(/^\| `([^`]+)` \| (.*?) \| (.*?) \| (?:yes|no) \|$/);
    if (!match) continue;
    const values = match[3] === "—" ? [] : match[3]!.split(", ").map((value) => value.replace(/^`|`$/g, ""));
    rows.set(match[1]!, { type: match[2]!.replace(/\\\|/g, "|"), values });
  }
  return rows;
}

const base = fullSample(schema) as Record<string, unknown>;

test("the generated document is valid and every field has fixtures", () => {
  assert.deepEqual(validateConfigWithZod(base).errors, []);
  const docs = documentedFields();
  const paths = fields.map((field) => field.path);
  assert.deepEqual([...docs.keys()].sort(), [...paths].sort());
  for (const path of paths) assert.ok(schemaAt(path) !== undefined, path);
  assert.ok(paths.includes("fonts[].family"));
  assert.ok(!paths.includes("video.tags[]"));
});

test("each field fixture is accepted or rejected identically by all surfaces", () => {
  const docs = documentedFields();
  for (const field of fields) {
    const node = schemaAt(field.path);
    const valid = withPath(base, field.path, sample(node));
    const invalid = skipInvalid.has(field.path) ? undefined : withPath(base, field.path, invalidSample(node));

    assert.deepEqual(validateConfigWithZod(valid).errors, [], `runtime schema accepts ${field.path}`);

    const normalized = normalizeConfig(valid as Record<string, unknown>);
    assert.deepEqual(validateNormalizedConfigWithZod(normalized).errors, [], `normalized schema accepts ${field.path}`);

    const command = validateAuthoringConfig(valid);
    assert.deepEqual(command.errors.map((error) => error.message), [], `validate accepts ${field.path}`);

    assert.deepEqual(jsonErrors(schema, valid), [], `json schema accepts ${field.path}`);

    const row = docs.get(field.path);
    assert.ok(row, `documentation lists ${field.path}`);
    assert.ok(row.type.length > 0, `documentation types ${field.path}`);

    if (invalid === undefined) continue;
    const runtimeIssues = validateConfigWithZod(invalid).errors;
    assert.ok(runtimeIssues.length > 0, `runtime schema rejects ${field.path}`);
    assert.ok(
      runtimeIssues.some((issue) => fieldOfZodPath(issue.path) === field.path || fieldOfZodPath(issue.path).startsWith(`${field.path}.`)),
      `runtime schema locates ${field.path}`,
    );

    const commandErrors = validateAuthoringConfig(invalid).errors;
    assert.ok(commandErrors.length > 0, `validate rejects ${field.path}`);
    const located = commandErrors.some((error) => {
      const issuePath = (error.cause as { path?: string } | undefined)?.path;
      const mapped = issuePath === undefined ? "" : fieldOfZodPath(issuePath);
      return mapped === field.path || mapped.startsWith(`${field.path}.`) || error.message.includes(field.path);
    });
    assert.ok(located, `validate locates ${field.path}: ${commandErrors[0]?.message}`);

    const schemaErrors = jsonErrors(schema, invalid).map(fieldOfJsonPath);
    assert.ok(schemaErrors.length > 0, `json schema rejects ${field.path}`);
    assert.ok(schemaErrors.includes(field.path), `json schema locates ${field.path}: ${schemaErrors.join(", ")}`);

    if (row.values.length > 0) assert.ok(!row.values.includes(JSON.stringify(invalid)), `documentation excludes invalid ${field.path}`);
  }
});

test("unknown keys are rejected with their path everywhere", () => {
  const doc = { ...base, unexpectedKey: true, render: { ...(base.render as object), bogusOption: 1 } };
  const issues = validateConfigWithZod(doc).errors;
  assert.ok(issues.some((issue) => issue.code === "unrecognized_keys" && issue.keys?.includes("unexpectedKey")));
  assert.ok(issues.some((issue) => issue.keys?.includes("bogusOption")));

  const errors = validateAuthoringConfig(doc).errors;
  assert.ok(errors.some((error) => error.code === ErrorCode.CC1002 && error.message.includes("render.bogusOption")));

  const json = jsonErrors(schema, doc).map(fieldOfJsonPath).sort();
  assert.deepEqual(json, ["render.bogusOption", "unexpectedKey"]);
  assert.ok(!documentedFields().has("unexpectedKey"));

  const dir = mkdtempSync(join(tmpdir(), "cinecode-schema-"));
  const configPath = join(dir, "cinecode.config.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 2, render: { bogusOption: 1 } }));
  const cli = fileURLToPath(new URL("../../cli/main.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "validate", "--config", configPath], { cwd: dir, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CC1002\]/);
  assert.match(result.stderr, /render\.bogusOption/);
});

test("the JSON schema regeneration is byte-identical", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  assert.equal(readFileSync(join(root, "cinecode.schema.json"), "utf8"), generateSchemaJson());
  const docs = fileURLToPath(new URL("../../../../../docs/config-reference.md", import.meta.url));
  assert.equal(readFileSync(docs, "utf8"), generateReferenceMarkdown());
});

test("the JSON schema carries the runtime version enum and field set", () => {
  const version = schemaAt("schemaVersion");
  assert.deepEqual((version.anyOf as JsonNode[]).map((branch) => branch.const), [...SCHEMA_VERSIONS]);
  const rejected = validateConfigWithZod({ ...base, schemaVersion: 3 }).errors;
  assert.ok(rejected.length > 0 && rejected.every((issue) => issue.path === "schemaVersion"));
  const stringVersion = validateConfigWithZod({ ...base, schemaVersion: "2" }).errors;
  assert.ok(stringVersion.length > 0 && stringVersion.every((issue) => issue.path === "schemaVersion"));
});

test("the shipped template config passes the same validator", async () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../../../packages/create-cinecode/templates/typescript/cinecode.config.ts", import.meta.url)),
    "utf8",
  )
    .replace("{{WIDTH}}", "1920")
    .replace("{{HEIGHT}}", "1080")
    .replace("{{FPS}}", "30")
    .replace("{{PROJECT_NAME}}", "parity")
    .replace(/^import .*$/m, "")
    .replace("defineConfig(", "(");
  const dir = mkdtempSync(join(tmpdir(), "cinecode-template-"));
  const file = join(dir, "cinecode.config.mjs");
  writeFileSync(file, source);
  const template = (await import(pathToFileURL(file).href)).default as Record<string, unknown>;

  assert.deepEqual(validateAuthoringConfig(template).errors, []);
  const normalized = normalizeConfig(template);
  assert.deepEqual(validateNormalizedConfig(normalized).errors, []);
  assert.equal(normalized.render.concurrency, "auto");
  assert.deepEqual(validateConfig(normalized, file).errors, []);
});
