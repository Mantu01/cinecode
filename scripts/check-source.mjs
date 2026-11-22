import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [path.join(root, "scripts"), path.join(root, "packages")];
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);
const ignored = new Set(["node_modules", "dist", "dist-test", ".turbo", "coverage", ".cinecode"]);

const backslashSpecifier = /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"'\n]*\\[^"'\n]*["']/;
const shellTrue = /\bshell\s*:\s*true\b/;

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

const thisFile = fileURLToPath(import.meta.url);
const findings = [];
for (const dir of roots) {
  if (!statSync(dir).isDirectory()) continue;
  for (const file of sourceFiles(dir)) {
    if (file === thisFile) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (backslashSpecifier.test(line)) {
        findings.push(`${path.relative(root, file)}:${index + 1}: module specifier contains a backslash`);
      }
      if (shellTrue.test(line)) {
        findings.push(`${path.relative(root, file)}:${index + 1}: spawn uses shell: true`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`${findings.join("\n")}\nfix: use forward-slash specifiers and spawn without a shell.`);
  process.exit(1);
}
console.log("source check ok: no backslash specifiers, no shell: true");
