import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TEST_ONLY = /(^|\/)__tests__\//;
const TEST_FILE = /\.test\.[^/]+$/;
const AUDIO_TEST = /(^|\/)audio\/test\.[^/]+$/;
const SCRIPT = /\.js$/;
const DECLARATION = /\.d\.ts$/;
const SOURCE_MAP_COMMENT = /\/\/# sourceMappingURL=(\S+)\s*$/gm;
const NODE_SHEBANG = "#!/usr/bin/env node";

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function isTestOnly(relative) {
  return TEST_ONLY.test(relative) || TEST_FILE.test(relative) || AUDIO_TEST.test(relative);
}

/**
 * Check one package's compiled output.
 * Throws one error listing every failing path when any check fails.
 */
export function assertBuildOutput({ packageDir, emitDir, binEntries = [] }) {
  if (!existsSync(emitDir)) {
    throw new Error(`build output missing: ${emitDir}\nfix: run the package build before asserting output.`);
  }

  const files = walk(emitDir).sort();
  const relative = files.map((file) => path.relative(emitDir, file).split(path.sep).join("/"));
  const present = new Set(files);
  const failures = [];

  const scripts = files.filter((file) => SCRIPT.test(file));
  const declarations = files.filter((file) => DECLARATION.test(file));

  const missingDeclarations = scripts.filter((file) => !present.has(file.replace(/\.js$/, ".d.ts")));
  if (missingDeclarations.length > 0) {
    failures.push(`scripts without a declaration:\n${missingDeclarations.map((file) => `  ${file}`).join("\n")}`);
  }

  const missingScripts = declarations.filter((file) => !present.has(file.replace(/\.d\.ts$/, ".js")));
  if (missingScripts.length > 0) {
    failures.push(`declarations without a script:\n${missingScripts.map((file) => `  ${file}`).join("\n")}`);
  }

  const testModules = relative.filter(isTestOnly).map((file) => path.join(emitDir, file));
  if (testModules.length > 0) {
    failures.push(`test-only modules emitted:\n${testModules.map((file) => `  ${file}`).join("\n")}`);
  }

  const empty = files.filter((file) => statSync(file).size === 0);
  if (empty.length > 0) {
    failures.push(`zero-byte files:\n${empty.map((file) => `  ${file}`).join("\n")}`);
  }

  const missingBins = binEntries.filter((file) => !existsSync(file));
  if (missingBins.length > 0) {
    failures.push(`bin entries missing:\n${missingBins.map((file) => `  ${file}`).join("\n")}`);
  }
  const badShebangs = binEntries.filter((file) => {
    if (!existsSync(file)) return false;
    const firstLine = readFileSync(file, "utf8").split("\n", 1)[0];
    return firstLine !== NODE_SHEBANG;
  });
  if (badShebangs.length > 0) {
    failures.push(`bin entries without the node shebang:\n${badShebangs.map((file) => `  ${file}`).join("\n")}`);
  }

  const maps = files.filter((file) => file.endsWith(".map"));
  const danglingMaps = [];
  for (const file of [...scripts, ...declarations]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SOURCE_MAP_COMMENT)) {
      const target = path.resolve(path.dirname(file), match[1]);
      if (!present.has(target)) danglingMaps.push(`${file}: ${target}`);
    }
  }
  for (const file of maps) {
    let sources;
    try {
      sources = JSON.parse(readFileSync(file, "utf8")).sources;
    } catch {
      danglingMaps.push(`${file}: not valid JSON`);
      continue;
    }
    if (!Array.isArray(sources) || sources.length === 0) {
      danglingMaps.push(`${file}: no sources`);
      continue;
    }
    for (const source of sources) {
      if (!present.has(path.resolve(path.dirname(file), source))) danglingMaps.push(`${file}: ${source}`);
    }
  }
  if (danglingMaps.length > 0) {
    failures.push(`source maps pointing at missing files:\n${danglingMaps.map((entry) => `  ${entry}`).join("\n")}`);
  }

  if (scripts.length === 0) failures.push(`no scripts emitted under ${emitDir}`);

  if (failures.length > 0) {
    throw new Error(
      [
        `build output check failed for ${packageDir}`,
        "checked: script/declaration parity both ways, test-only modules, bin shebang, zero-byte files, source maps",
        ...failures,
        "fix: correct the offending source paths and rebuild.",
      ].join("\n"),
    );
  }

  return {
    scripts: scripts.length,
    declarations: declarations.length,
    maps: maps.length,
    bins: binEntries.length,
    files: files.length,
  };
}
