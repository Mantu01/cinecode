import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(rootDir, "packages", "cinecode", "src");

export function checkSilentCatches(dir = srcDir) {
  const violations = [];

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
    // Find all catch blocks: catch (...) { ... } or catch { ... }
    const catchRegex = /catch\s*(?:\([^)]*\))?\s*\{/g;
    let match;

    while ((match = catchRegex.exec(content)) !== null) {
      const startIndex = match.index + match[0].length;
      // Count braces to find matching closing brace
      let depth = 1;
      let currentIndex = startIndex;
      while (depth > 0 && currentIndex < content.length) {
        const char = content[currentIndex];
        if (char === "{") depth++;
        else if (char === "}") depth--;
        currentIndex++;
      }

      const bodyWithComments = content.slice(startIndex, currentIndex - 1);
      // Strip comments and trivial void 0
      const bodyClean = bodyWithComments
        .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
        .replace(/\bvoid\s+0\s*;?/g, "")
        .trim();

      // An empty catch has no executable statements
      const isEmpty = bodyClean.length === 0;
      // Recorded note must contain 'Note:'
      const hasNote = /(?:\/\/|\/\*)[^\n]*?\bNote:/i.test(bodyWithComments);

      // If empty catch without a recorded note, it is a violation
      if (isEmpty && !hasNote) {
        const beforeCatch = content.slice(0, match.index);
        const lineNumber = beforeCatch.split("\n").length;
        const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");
        violations.push({
          file: relPath,
          line: lineNumber,
          snippet: `catch { ${bodyWithComments.trim()} }`,
        });
      }
    }
  }

  scan(dir);
  return violations;
}

if (process.argv.includes("--test-injection")) {
  const tempFile = path.join(srcDir, "temp-test-silent-catch.ts");
  const testSample = "try { doWork(); } catch { void 0; }";
  fs.writeFileSync(tempFile, testSample);
  try {
    const tempViolations = checkSilentCatches(srcDir).filter((v) => v.file.includes("temp-test-silent-catch"));
    if (tempViolations.length === 0) {
      console.error("FAIL: Silent catch gate failed to catch injected violation");
      process.exit(1);
    }
    console.log("PASS: Silent catch gate caught injected violation cleanly");
    process.exit(0);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("silent-catches.mjs")) {
  const violations = checkSilentCatches();
  if (violations.length > 0) {
    console.error(`FAILED: Found ${violations.length} silent catch block(s) without a documented note:`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} -> ${v.snippet}`);
    }
    process.exit(1);
  }
  console.log("PASS: 0 silent catch blocks detected across shipped source.");
}
