import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
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

const schemaPath = path.join(pkg, "cinecode.schema.json");
const { generateSchemaJson } = await import(pathToFileURL(path.join(pkg, "src/config/json-schema.ts")).href);
const generatedSchema = generateSchemaJson();
JSON.parse(generatedSchema);
if (readFileSync(schemaPath, "utf8") !== generatedSchema) {
  fail("cinecode.schema.json is stale; run pnpm generate:schema");
}

const manifest = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));

execFileSync(
  process.execPath,
  [path.resolve(pkg, "..", "..", "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
  { cwd: pkg, stdio: "inherit" },
);

const binEntry = path.join(dist, "esm", "cli", "main.js");
const binSource = readFileSync(binEntry, "utf8");
if (!binSource.startsWith("#!")) writeFileSync(binEntry, `#!/usr/bin/env node\n${binSource}`, "utf8");
if (!readFileSync(binEntry, "utf8").startsWith("#!/usr/bin/env node")) fail("cli entry is not executable as a script");

pruneDeclarations(pkg, declarationEntriesOf(manifest));
assertTargets(pkg, manifest);

const pack = packFiles(pkg);
assertPack(pkg, manifest, pack.files);
report("build", startedAt, [dist], pack);
