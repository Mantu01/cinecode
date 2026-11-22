import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeSrc = path.join(root, "packages", "cinecode", "src");
const codesFile = path.join(cinecodeSrc, "errors", "codes.ts");
const exitCodesFile = path.join(cinecodeSrc, "cli", "exit-codes.ts");

const findings = [];

// 1. Parse ErrorCode enum from codes.ts
const codesSource = readFileSync(codesFile, "utf8");
const enumMatch = codesSource.match(/export\s+enum\s+ErrorCode\s*\{([\s\S]*?)\}/);
if (!enumMatch) {
  console.error("check-errors: failed to parse ErrorCode enum from codes.ts");
  process.exit(1);
}

const enumCodes = new Set();
for (const match of enumMatch[1].matchAll(/(\w+)\s*=\s*["'](CC\d{4})["']/g)) {
  enumCodes.add(match[2]);
}

if (enumCodes.size === 0) {
  findings.push("No ErrorCode members found");
}

// 2. Parse ErrorMessages and FIX_HINTS keys
function extractKeysFromObjectLiteral(source, objectName) {
  const regex = new RegExp(`export\\s+const\\s+${objectName}[^{]*\\{([\\s\\S]*?)\\n\\};`);
  const match = source.match(regex);
  if (!match) return new Set();
  const keys = new Set();
  for (const m of match[1].matchAll(/\[ErrorCode\.(\w+)\]\s*:\s*(?:`|"|')([^`"'\n]+)/g)) {
    keys.add(m[1]);
  }
  return keys;
}

const messageKeys = extractKeysFromObjectLiteral(codesSource, "ErrorMessages");
const fixHintKeys = extractKeysFromObjectLiteral(codesSource, "FIX_HINTS");

for (const code of enumCodes) {
  if (!messageKeys.has(code)) {
    findings.push(`ErrorCode.${code} missing from ErrorMessages in codes.ts`);
  }
  if (!fixHintKeys.has(code)) {
    findings.push(`ErrorCode.${code} missing from FIX_HINTS in codes.ts`);
  }
}

// 3. Parse EXIT_CODE_RULES from exit-codes.ts
const exitSource = readFileSync(exitCodesFile, "utf8");
const ruleMatches = [...exitSource.matchAll(/\{\s*prefix\s*:\s*["']([^"']+)["']\s*,\s*exit\s*:\s*["']([^"']+)["']\s*\}/g)];
const exitRules = ruleMatches.map((m) => ({ prefix: m[1], exit: m[2] }));

for (const code of enumCodes) {
  const matchedRule = exitRules.find((rule) => code.startsWith(rule.prefix));
  if (!matchedRule) {
    findings.push(`ErrorCode.${code} has no matching prefix rule in EXIT_CODE_RULES`);
  }
}

// 4. Scan source files for plain Error throws with CC\d{4} and unknown codes
function getSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getSourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

const srcFiles = getSourceFiles(cinecodeSrc);
const plainErrorRegex = /new\s+(?:[A-Za-z0-9_]*Error)\s*\([^)]*CC\d{4}/g;
const codeLiteralRegex = /\bCC\d{4}\b/g;
const processExitRegex = /\bprocess\.exit\s*\(/g;

for (const file of srcFiles) {
  const content = readFileSync(file, "utf8");
  const relPath = path.relative(root, file);

  // Check plain Error throws
  const plainMatches = content.match(plainErrorRegex);
  if (plainMatches) {
    for (const match of plainMatches) {
      findings.push(`${relPath}: plain error instantiated with code literal: ${match}`);
    }
  }

  // Check unknown CC\d{4} literals (skip codes.ts and exit-codes.ts itself)
  if (file !== codesFile && file !== exitCodesFile) {
    const codeMatches = content.match(codeLiteralRegex);
    if (codeMatches) {
      for (const code of codeMatches) {
        if (!enumCodes.has(code)) {
          findings.push(`${relPath}: unknown error code literal '${code}' not in ErrorCode enum`);
        }
      }
    }
  }

  // Check process.exit calls
  if (processExitRegex.test(content)) {
    const isMain = file.endsWith(path.join("cli", "main.ts"));
    const isFrameWorker = file.endsWith(path.join("pipeline", "frame-worker.ts"));
    if (!isMain && !isFrameWorker) {
      findings.push(`${relPath}: process.exit() called outside single process entry point`);
    }
  }
}

if (findings.length > 0) {
  console.error("check-errors failed with violations:");
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  process.exit(1);
}

console.log(`check-errors ok: ${enumCodes.size} codes verified with messages, fix hints, exit codes, and typed constructors`);
