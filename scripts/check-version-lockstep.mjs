#!/usr/bin/env node

/**
 * Phase 30: Version Lockstep & Metadata Identity Verification
 * Validates version sync across packages, scaffolder range, changelogs,
 * and single metadata identity across the monorepo.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const CINECODE_DIR = path.join(ROOT_DIR, "packages/cinecode");
const CREATE_DIR = path.join(ROOT_DIR, "packages/create-cinecode");

let failed = false;

function pass(name, msg) {
  console.log(`[PASS] ${name}: ${msg}`);
}

function fail(name, msg) {
  console.error(`[FAIL] ${name}: ${msg}`);
  failed = true;
}

// 1. Version lockstep
const pkgCinecode = JSON.parse(fs.readFileSync(path.join(CINECODE_DIR, "package.json"), "utf8"));
const pkgCreate = JSON.parse(fs.readFileSync(path.join(CREATE_DIR, "package.json"), "utf8"));

const version = pkgCinecode.version;

if (pkgCreate.version === version) {
  pass("Version Lockstep", `Both cinecode and create-cinecode share version ${version}`);
} else {
  fail("Version Lockstep", `Version mismatch: cinecode is ${version}, create-cinecode is ${pkgCreate.version}`);
}

// 2. Scaffolder framework range
const scaffoldSrc = fs.readFileSync(path.join(CREATE_DIR, "src/scaffold.ts"), "utf8");
const rangeMatch = /export const FRAMEWORK_RANGE\s*=\s*["']([^"']+)["']/.exec(scaffoldSrc);

if (rangeMatch && rangeMatch[1]) {
  const range = rangeMatch[1];
  const expectedRange = `^${version}`;
  if (range === expectedRange) {
    pass("Scaffolder Framework Range", `FRAMEWORK_RANGE in scaffold.ts is "${range}", exactly matching ^${version}`);
  } else {
    fail("Scaffolder Framework Range", `FRAMEWORK_RANGE is "${range}", expected "${expectedRange}"`);
  }
} else {
  fail("Scaffolder Framework Range", "Could not find FRAMEWORK_RANGE in scaffold.ts");
}

// 3. Changelog entries
for (const [label, file] of [
  ["Root Changelog", path.join(ROOT_DIR, "CHANGELOG.md")],
  ["Cinecode Changelog", path.join(CINECODE_DIR, "CHANGELOG.md")],
  ["Create-Cinecode Changelog", path.join(CREATE_DIR, "CHANGELOG.md")],
]) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(`## [${version}]`)) {
      pass(label, `Documents version [${version}]`);
    } else {
      fail(label, `Missing entry for ## [${version}] in ${file}`);
    }
  } else {
    fail(label, `Missing file ${file}`);
  }
}

// 4. Metadata identity across packages
for (const [pkgName, pkg] of [["cinecode", pkgCinecode], ["create-cinecode", pkgCreate]]) {
  if (pkg.license !== "MIT") {
    fail(`${pkgName} license`, `Expected MIT, got ${pkg.license}`);
  } else {
    pass(`${pkgName} license`, "MIT");
  }

  const authorName = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  if (authorName !== "Cinecode") {
    fail(`${pkgName} author`, `Expected Cinecode, got ${authorName}`);
  } else {
    pass(`${pkgName} author`, "Cinecode");
  }

  if (pkg.homepage !== "https://github.com/Mantu01/cinecode#readme") {
    fail(`${pkgName} homepage`, `Expected https://github.com/Mantu01/cinecode#readme, got ${pkg.homepage}`);
  } else {
    pass(`${pkgName} homepage`, "https://github.com/Mantu01/cinecode#readme");
  }

  const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repoUrl !== "git+https://github.com/Mantu01/cinecode.git") {
    fail(`${pkgName} repository`, `Expected git+https://github.com/Mantu01/cinecode.git, got ${repoUrl}`);
  } else {
    pass(`${pkgName} repository`, "git+https://github.com/Mantu01/cinecode.git");
  }

  // Notices in files list
  const filesList = pkg.files || [];
  if (!filesList.includes("THIRD_PARTY_NOTICES.md")) {
    fail(`${pkgName} notices list`, "THIRD_PARTY_NOTICES.md missing from files allowlist");
  } else {
    pass(`${pkgName} notices list`, "THIRD_PARTY_NOTICES.md present in files allowlist");
  }
}

// 5. Physical notice and license files exist
if (fs.existsSync(path.join(ROOT_DIR, "LICENSE")) &&
    fs.existsSync(path.join(CINECODE_DIR, "LICENSE")) &&
    fs.existsSync(path.join(CREATE_DIR, "LICENSE"))) {
  pass("License files", "LICENSE exists at root and in both packages");
} else {
  fail("License files", "LICENSE missing from one or more locations");
}

if (fs.existsSync(path.join(CINECODE_DIR, "THIRD_PARTY_NOTICES.md")) &&
    fs.existsSync(path.join(CREATE_DIR, "THIRD_PARTY_NOTICES.md"))) {
  pass("Notices files", "THIRD_PARTY_NOTICES.md exists in both packages");
} else {
  fail("Notices files", "THIRD_PARTY_NOTICES.md missing in one or more packages");
}

if (failed) {
  console.error("\n❌ Version lockstep check FAILED");
  process.exit(1);
} else {
  console.log("\n✅ All Version Lockstep & Metadata checks PASSED");
  process.exit(0);
}
