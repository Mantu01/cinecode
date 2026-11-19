import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const tsc = resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc");

execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "inherit" });
const { generateSchemaJson, generateReferenceMarkdown, generateManifestReferenceMarkdown } = await import(
  pathToFileURL(resolve(packageRoot, "dist/esm/config/json-schema.js")).href
);
const outputPath = resolve(packageRoot, "cinecode.schema.json");
writeFileSync(outputPath, generateSchemaJson(), "utf-8");
const docsDir = resolve(packageRoot, "..", "..", "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(resolve(docsDir, "config-reference.md"), generateReferenceMarkdown(), "utf-8");
writeFileSync(resolve(docsDir, "manifest-reference.md"), generateManifestReferenceMarkdown(), "utf-8");
const { formatReferenceMarkdown } = await import(
  pathToFileURL(resolve(packageRoot, "dist/esm/core/output-plan.js")).href
);
writeFileSync(resolve(docsDir, "output-formats.md"), formatReferenceMarkdown(), "utf-8");

const { generateCommandReferenceMarkdown } = await import(
  pathToFileURL(resolve(here, "generate-command-reference.mjs")).href
);
writeFileSync(resolve(docsDir, "command-reference.md"), await generateCommandReferenceMarkdown(), "utf-8");

console.log(`schema: wrote ${outputPath}`);
