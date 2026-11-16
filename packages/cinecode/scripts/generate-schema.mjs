import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const moduleUrl = pathToFileURL(resolve(packageRoot, "src/config/json-schema.ts")).href;
const { generateSchemaJson } = await import(moduleUrl);
const outputPath = resolve(packageRoot, "cinecode.schema.json");
const json = generateSchemaJson();
writeFileSync(outputPath, json, "utf-8");
writeFileSync(
  resolve(packageRoot, ".schema-hash"),
  createHash("sha256").update(json).digest("hex") + "\n",
  "utf-8",
);
console.log(`schema: wrote ${outputPath}`);
