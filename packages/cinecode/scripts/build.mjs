import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  assertPack,
  assertTargets,
  cleanDir,
  fail,
  declarationEntriesOf,
  packFiles,
  pruneDeclarations,
  report,
} from "../../../scripts/artifact.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const dist = path.join(pkg, "dist");
const startedAt = Date.now();

cleanDir(dist);

const manifest = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
const { MIN_NODE_VERSION } = await import(pathToFileURL(path.join(pkg, "src/loader/runtime.ts")).href);
if (manifest.engines?.node !== `>=${MIN_NODE_VERSION}`) {
  fail(`engines.node is ${manifest.engines?.node}, but the runtime support contract declares >=${MIN_NODE_VERSION}`);
}

execFileSync(
  process.execPath,
  [path.resolve(pkg, "..", "..", "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
  { cwd: pkg, stdio: "inherit" },
);

const schemaPath = path.join(pkg, "cinecode.schema.json");
const { generateSchemaJson, generateReferenceMarkdown } = await import(pathToFileURL(path.join(dist, "esm/config/json-schema.js")).href);
const generatedSchema = generateSchemaJson();
JSON.parse(generatedSchema);
if (readFileSync(schemaPath, "utf8") !== generatedSchema) {
  fail("cinecode.schema.json is stale; run pnpm generate:schema");
}
const referencePath = path.resolve(pkg, "..", "..", "docs/config-reference.md");
if (!existsSync(referencePath) || readFileSync(referencePath, "utf8") !== generateReferenceMarkdown()) {
  fail("docs/config-reference.md is stale; run pnpm generate:schema");
}
const { formatReferenceMarkdown } = await import(pathToFileURL(path.join(dist, "esm/core/output-plan.js")).href);
const formatsPath = path.resolve(pkg, "..", "..", "docs/output-formats.md");
if (!existsSync(formatsPath) || readFileSync(formatsPath, "utf8") !== formatReferenceMarkdown()) {
  fail("docs/output-formats.md is stale; run pnpm generate:schema");
}

const binEntry = path.join(dist, "esm", "cli", "main.js");
const binSource = readFileSync(binEntry, "utf8");
if (!binSource.startsWith("#!")) writeFileSync(binEntry, `#!/usr/bin/env node\n${binSource}`, "utf8");
if (!readFileSync(binEntry, "utf8").startsWith("#!/usr/bin/env node")) fail("cli entry is not executable as a script");

pruneDeclarations(pkg, declarationEntriesOf(manifest));
assertTargets(pkg, manifest);

const pack = packFiles(pkg);
assertPack(pkg, manifest, pack.files);
report("build", startedAt, [dist], pack);
