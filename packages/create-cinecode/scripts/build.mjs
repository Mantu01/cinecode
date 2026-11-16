import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import {
  assertPack,
  assertTargets,
  cleanDir,
  declarationEntriesOf,
  fail,
  packFiles,
  pruneDeclarations,
  report,
} from "../../../scripts/artifact.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const dist = path.join(pkg, "dist");
const startedAt = Date.now();

cleanDir(dist);

execFileSync(
  process.execPath,
  [path.resolve(pkg, "..", "..", "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
  { cwd: pkg, stdio: "inherit" },
);

cpSync(path.join(pkg, "templates"), path.join(dist, "esm", "templates"), { recursive: true });

const binEntry = path.join(dist, "esm", "cli.js");
const binSource = readFileSync(binEntry, "utf8");
if (!binSource.startsWith("#!")) writeFileSync(binEntry, `#!/usr/bin/env node\n${binSource}`, "utf8");
if (!readFileSync(binEntry, "utf8").startsWith("#!/usr/bin/env node")) fail("cli entry is not executable as a script");

const manifest = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
pruneDeclarations(pkg, declarationEntriesOf(manifest));
assertTargets(pkg, manifest);

const pack = packFiles(pkg);
assertPack(pkg, manifest, pack.files);
report("build", startedAt, [dist], pack);
