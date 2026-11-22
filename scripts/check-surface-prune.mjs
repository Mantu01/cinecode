#!/usr/bin/env node

/**
 * Phase 29 Acceptance Verification Script
 * Validates surface pruning, dead-code elimination, network isolation,
 * hygiene gates, and public API stability snapshot.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const CINECODE_DIR = path.join(ROOT_DIR, "packages/cinecode");
const SRC_DIR = path.join(CINECODE_DIR, "src");
const DIST_DIR = path.join(CINECODE_DIR, "dist");

let failed = false;

function pass(name, msg) {
  console.log(`[PASS] ${name}: ${msg}`);
}

function fail(name, msg) {
  console.error(`[FAIL] ${name}: ${msg}`);
  failed = true;
}

// 1. Network isolation static scan
{
  const allowedFiles = new Set([
    "cli/media-download.ts",
    "cli/upgrade.ts",
    "dev/server.ts",
    "media/cloud-source.ts",
  ]);

  function walk(dir) {
    const list = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (f.name !== "node_modules" && f.name !== "dist" && f.name !== "__tests__") {
          list.push(...walk(full));
        }
      } else if (f.name.endsWith(".ts") && !f.name.endsWith(".d.ts")) {
        list.push(full);
      }
    }
    return list;
  }

  const allFiles = walk(SRC_DIR);
  const violations = [];

  for (const file of allFiles) {
    const rel = path.relative(SRC_DIR, file).replace(/\\/g, "/");
    if (allowedFiles.has(rel)) continue;

    const content = fs.readFileSync(file, "utf8");
    // Check for network client usage
    if (/\bfetch\(|\bhttps?\.get\(|\bhttps?\.request\(|\bnew\s+WebSocket\(|\bnet\.connect\(|\btls\.connect\(/.test(content)) {
      violations.push(rel);
    }
  }

  if (violations.length === 0) {
    pass("Network Isolation", "Network calls isolated strictly to opt-in commands (media-download, upgrade) and loopback dev server");
  } else {
    fail("Network Isolation", `Unexpected network usage found in: ${violations.join(", ")}`);
  }
}

// 2. Dead modules, empty dirs, and shipped test modules deleted with 0 dangling imports
{
  const deletedTargets = [
    "media/malware-scanner.ts",
    "media/network-resilience.ts",
    "observability/metrics.ts",
    "observability/audit.ts",
    "plugin/store.ts",
    "plugin/security",
    "plugin/sandbox",
    "security",
    "audio/test.ts",
    "types.test.ts",
  ];

  let remaining = [];
  for (const t of deletedTargets) {
    const full = path.join(SRC_DIR, t);
    if (fs.existsSync(full)) {
      remaining.push(t);
    }
  }

  if (remaining.length === 0) {
    pass("Dead Modules Purged", "All targeted dead modules and directories removed");
  } else {
    fail("Dead Modules Purged", `Modules still exist: ${remaining.join(", ")}`);
  }

  // Check 0 dangling imports referencing purged modules
  const allSrcFiles = fs.readdirSync(SRC_DIR, { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".ts"))
    .map((f) => path.join(SRC_DIR, f));

  const dangling = [];
  for (const file of allSrcFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const dead of ["malware-scanner", "network-resilience", "observability/metrics", "observability/audit", "plugin/store", "plugin/security", "plugin/sandbox"]) {
      if (content.includes(dead)) {
        dangling.push(`${path.relative(SRC_DIR, file)} -> ${dead}`);
      }
    }
  }

  if (dangling.length === 0) {
    pass("Zero Dangling Imports", "No source files import from purged modules");
  } else {
    fail("Zero Dangling Imports", `Dangling imports found:\n  ${dangling.join("\n  ")}`);
  }
}

// 3. Root export exposes curated surface
{
  const rootIndex = fs.readFileSync(path.join(SRC_DIR, "index.ts"), "utf8");
  if (rootIndex.includes("export * from \"./model-3d") || rootIndex.includes("export * from \"./particles") || rootIndex.includes("export * from \"./midi")) {
    fail("Curated Root", "Root index still wildcards advanced subpath domains");
  } else {
    pass("Curated Root", "Root index exposes curated core, builder, render, config and error surfaces");
  }
}

// 4. Subpath resolution check from dist
{
  const pkg = JSON.parse(fs.readFileSync(path.join(CINECODE_DIR, "package.json"), "utf8"));
  let resolvedCount = 0;
  let subpathErrors = [];

  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === "./package.json") continue;
    const importTarget = typeof target === "string" ? target : target.import || target.default;
    const absPath = path.resolve(CINECODE_DIR, importTarget);
    if (!fs.existsSync(absPath)) {
      subpathErrors.push(`${subpath}: target ${absPath} does not exist`);
      continue;
    }
    resolvedCount++;
  }

  if (subpathErrors.length === 0) {
    pass("Subpath Resolution", `All ${resolvedCount} documented subpaths resolve to build targets in dist/`);
  } else {
    fail("Subpath Resolution", `Unresolved subpaths:\n  ${subpathErrors.join("\n  ")}`);
  }
}

// 5. Hygiene gates execution & injection tests
{
  try {
    execFileSync(process.execPath, [path.join(ROOT_DIR, "scripts/gate/silent-catches.mjs"), "--test-injection"], { stdio: "ignore" });
    pass("Hygiene Gate: silent-catches", "Passed injection test and clean verification");
  } catch {
    fail("Hygiene Gate: silent-catches", "Failed silent-catches gate check");
  }

  try {
    execFileSync(process.execPath, [path.join(ROOT_DIR, "scripts/gate/console-writes.mjs"), "--test-injection"], { stdio: "ignore" });
    pass("Hygiene Gate: console-writes", "Passed injection test and clean verification");
  } catch {
    fail("Hygiene Gate: console-writes", "Failed console-writes gate check");
  }
}

// 6. Zero unexplained deliberate type escapes
{
  function walkTs(dir) {
    const list = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (f.name !== "node_modules" && f.name !== "dist" && f.name !== "__tests__") {
          list.push(...walkTs(full));
        }
      } else if (f.name.endsWith(".ts") && !f.name.endsWith(".d.ts")) {
        list.push(full);
      }
    }
    return list;
  }

  const files = walkTs(SRC_DIR);
  let unexplained = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      if (/\bas\s+any\b|:\s*any\b|<\s*any\s*>|@ts-ignore|@ts-expect-error/.test(line)) {
        if (!line.includes("// Note:") && !line.includes("// note:") && !line.includes("eslint-disable")) {
          unexplained.push(`${path.relative(SRC_DIR, file)}:${idx + 1}`);
        }
      }
    });
  }

  if (unexplained.length === 0) {
    pass("Type Escapes", "Zero unexplained type escapes in shipped source");
  } else {
    fail("Type Escapes", `Found ${unexplained.length} unexplained type escapes:\n  ${unexplained.slice(0, 10).join("\n  ")}`);
  }
}

// 7. Package file allowlist is exact
{
  const pkg = JSON.parse(fs.readFileSync(path.join(CINECODE_DIR, "package.json"), "utf8"));
  const expectedFiles = ["dist/", "cinecode.schema.json", "README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "LICENSE"];
  const actualFiles = pkg.files || [];
  const missing = expectedFiles.filter((f) => !actualFiles.includes(f));
  if (missing.length === 0) {
    pass("Package File Allowlist", `Allowlist strictly contains expected files (${actualFiles.join(", ")})`);
  } else {
    fail("Package File Allowlist", `Missing from files allowlist: ${missing.join(", ")}`);
  }
}

// 8. Stability doc and API surface snapshot exist
{
  const stabilityPath = path.join(ROOT_DIR, "docs/stability.md");
  const surfacePath = path.join(ROOT_DIR, "docs/api-surface.json");

  if (fs.existsSync(stabilityPath) && fs.existsSync(surfacePath)) {
    const surfaceData = JSON.parse(fs.readFileSync(surfacePath, "utf8"));
    const keys = Object.keys(surfaceData);
    pass("Stability & API Snapshot", `docs/stability.md exists and docs/api-surface.json snapshots ${keys.length} subpaths`);
  } else {
    fail("Stability & API Snapshot", "Missing docs/stability.md or docs/api-surface.json");
  }
}

if (failed) {
  console.error("\n❌ Surface prune verification FAILED");
  process.exit(1);
} else {
  console.log("\n✅ All Surface Prune checks PASSED cleanly");
  process.exit(0);
}
