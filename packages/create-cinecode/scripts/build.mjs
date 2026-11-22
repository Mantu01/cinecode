import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertBuildOutput } from "../../../scripts/assert-output.mjs";
import { compareTemplates, writeTemplates } from "./generate-templates.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(pkgDir, "dist");
const emitDir = path.join(distDir, "esm");
const startedAt = Date.now();

const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const binEntries = Object.values(manifest.bin ?? {}).map((entry) => path.resolve(pkgDir, entry));

rmSync(distDir, { recursive: true, force: true });

const tsc = createRequire(path.join(pkgDir, "package.json")).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: pkgDir, stdio: "inherit" });

let output;
try {
  output = assertBuildOutput({ packageDir: pkgDir, emitDir, binEntries });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const templatesDir = path.join(emitDir, "templates");
writeTemplates(templatesDir);
const drift = compareTemplates(templatesDir);
if (drift.length > 0) {
  console.error(
    `template drift detected, checked-in templates must match templates/canonical:\n${drift.join("\n")}\nfix: edit templates/canonical or run pnpm --filter create-cinecode check:templates.`,
  );
  process.exit(1);
}

if (process.platform !== "win32") {
  for (const entry of binEntries) chmodSync(entry, 0o755);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `build ok: ${output.scripts} scripts, ${output.declarations} declarations, ${output.bins} bin, ${output.files} files, 2 template variants in ${seconds}s`,
);
