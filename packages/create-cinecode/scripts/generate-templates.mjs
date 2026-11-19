import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const canonicalDir = resolve(pkgRoot, "templates", "canonical");
const tsDir = resolve(pkgRoot, "templates", "typescript");
const jsDir = resolve(pkgRoot, "templates", "javascript");

function write(targetPath, content) {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
}

function read(rel) {
  return readFileSync(resolve(canonicalDir, rel), "utf8");
}

// Generate TypeScript
write(resolve(tsDir, "cinecode.config.ts"), read("cinecode.config.ts").replaceAll("{{EXT}}", "ts"));
write(resolve(tsDir, "main.ts"), read("main.ts").replaceAll("{{EXT}}", "ts"));
write(resolve(tsDir, "package.json"), read("package.json").replaceAll("{{TYPECHECK_SCRIPT}}", "tsc --noEmit"));
write(resolve(tsDir, "tsconfig.json"), read("tsconfig.json"));
write(resolve(tsDir, "README.md"), read("README.md"));
write(resolve(tsDir, "media", "README.md"), read("media/README.md"));
write(resolve(tsDir, "src", "audio", "ambient.ts"), read("src/audio/ambient.ts"));
write(resolve(tsDir, "src", "images", "thumbnail.ts"), read("src/images/thumbnail.ts"));
write(resolve(tsDir, "src", "scenes", "intro.ts"), read("src/scenes/intro.ts"));

// Generate JavaScript
write(resolve(jsDir, "cinecode.config.js"), read("cinecode.config.ts").replaceAll("{{EXT}}", "js"));
write(resolve(jsDir, "main.js"), read("main.ts").replaceAll("{{EXT}}", "js"));
write(resolve(jsDir, "package.json"), read("package.json").replaceAll("{{TYPECHECK_SCRIPT}}", "node --check main.js"));
write(resolve(jsDir, "jsconfig.json"), read("jsconfig.json"));
write(resolve(jsDir, "README.md"), read("README.md"));
write(resolve(jsDir, "media", "README.md"), read("media/README.md"));
write(resolve(jsDir, "src", "audio", "ambient.js"), read("src/audio/ambient.ts"));
write(resolve(jsDir, "src", "images", "thumbnail.js"), read("src/images/thumbnail.ts"));
write(resolve(jsDir, "src", "scenes", "intro.js"), read("src/scenes/intro.ts"));

console.log("Templates generated successfully from canonical source.");
