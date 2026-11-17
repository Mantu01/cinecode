import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const tsc = resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc");

execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "inherit" });
const { generateSchemaJson, generateReferenceMarkdown } = await import(
  pathToFileURL(resolve(packageRoot, "dist/esm/config/json-schema.js")).href
);
const outputPath = resolve(packageRoot, "cinecode.schema.json");
writeFileSync(outputPath, generateSchemaJson(), "utf-8");
const docsDir = resolve(packageRoot, "..", "..", "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(resolve(docsDir, "config-reference.md"), generateReferenceMarkdown(), "utf-8");
console.log(`schema: wrote ${outputPath}`);
