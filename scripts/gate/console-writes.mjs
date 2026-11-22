import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetDirs = [
  path.join(rootDir, "packages", "cinecode", "src", "core"),
  path.join(rootDir, "packages", "cinecode", "src", "pipeline"),
  path.join(rootDir, "packages", "cinecode", "src", "renderer"),
  path.join(rootDir, "packages", "cinecode", "src", "encoder"),
];

export function checkConsoleWrites(dirs = targetDirs) {
  const violations = [];

  for (const dir of dirs) {
    function scan(currentDir) {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__" && entry.name !== "dist") {
            scan(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) {
          checkFile(fullPath);
        }
      }
    }

    function checkFile(filePath) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Exclude comments
        const clean = line.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        if (/\bconsole\.(log|error|warn|info|debug|trace)\b/.test(clean)) {
          const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");
          violations.push({
            file: relPath,
            line: idx + 1,
            statement: line.trim(),
          });
        }
      });
    }

    scan(dir);
  }

  return violations;
}

if (process.argv.includes("--test-injection")) {
  const tempDir = targetDirs[0];
  const tempFile = path.join(tempDir, "temp-test-console-write.ts");
  const testSample = "export function bad() { console.log('bad write'); }";
  fs.writeFileSync(tempFile, testSample);
  try {
    const tempViolations = checkConsoleWrites([tempDir]).filter((v) => v.file.includes("temp-test-console-write"));
    if (tempViolations.length === 0) {
      console.error("FAIL: Console write gate failed to catch injected violation");
      process.exit(1);
    }
    console.log("PASS: Console write gate caught injected violation cleanly");
    process.exit(0);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("console-writes.mjs")) {
  const violations = checkConsoleWrites();
  if (violations.length > 0) {
    console.error(`FAILED: Found ${violations.length} console write(s) outside reporter in engine code:`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} -> ${v.statement}`);
    }
    process.exit(1);
  }
  console.log("PASS: 0 console writes in core/pipeline/renderer/encoder outside reporter.");
}

