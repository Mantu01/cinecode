import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const { generateSchemaJson } = await import(pathToFileURL(resolve(packageRoot, "src/config/json-schema.ts")).href);
const outputPath = resolve(packageRoot, "cinecode.schema.json");
writeFileSync(outputPath, generateSchemaJson(), "utf-8");
console.log(`schema: wrote ${outputPath}`);
