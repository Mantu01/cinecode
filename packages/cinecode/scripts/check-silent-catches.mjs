#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const CRITICAL = [
  "src/config/schema.ts",
  "src/config/migration/engine.ts",
  "src/manifest/index.ts",
  "src/media/resolver.ts",
  "src/media/frames.ts",
  "src/pipeline/cache.ts",
  "src/pipeline/checkpoint.ts",
  "src/pipeline/resume.ts",
  "src/pipeline/index.ts",
  "src/pipeline/progress.ts",
  "src/encoder/output.ts",
  "src/audio/prepare.ts",
  "src/audio/decode.ts",
  "src/cli/render.ts",
  "src/cli/still.ts",
  "src/cli/export-svg.ts",
  "src/cli/validate.ts",
  "src/cli/check.ts",
  "src/cli/generate.ts",
  "src/cli/thumbnail.ts",
];

const HANDLED = /(recordDegradation|reportDegradation|recordWarning|errors\.push|warnings\.push|throw|createError|process\.emitWarning)/;

function filesUnder(target) {
  const info = statSync(target);
  if (info.isFile()) return [target];
  const found = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function catchBodies(source) {
  const bodies = [];
  const matcher = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let match;
  while ((match = matcher.exec(source)) !== null) {
    const open = source.indexOf("{", match.index);
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    const line = source.slice(0, match.index).split("\n").length;
    bodies.push({ line, body: source.slice(open + 1, index - 1) });
  }
  return bodies;
}

const targets = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((arg) => path.resolve(arg))
  : CRITICAL.map((file) => path.join(root, file));

const violations = [];
for (const file of targets.flatMap(filesUnder)) {
  const source = readFileSync(file, "utf-8");
  for (const { line, body } of catchBodies(source)) {
    const clean = stripComments(body).trim();
    if (HANDLED.test(clean)) continue;
    violations.push(`${path.relative(root, file)}:${line}: caught error discarded without a code or reported degradation`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  console.error(`silent-catch check failed: ${violations.length} violation(s)`);
  process.exit(1);
}

console.log(`silent-catch check passed (${targets.length} target(s))`);
