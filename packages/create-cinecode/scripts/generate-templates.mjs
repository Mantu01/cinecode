import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(pkgRoot, "templates");
const canonicalDir = path.join(templatesRoot, "canonical");

const CANONICAL_FILES = [
  ".gitignore",
  "cinecode.config.ts",
  "jsconfig.json",
  "main.ts",
  "media/README.md",
  "output/.gitkeep",
  "package.json",
  "README.md",
  "src/components/title-card.ts",
  "src/scenes/intro.ts",
  "src/timelines/main.ts",
  "tsconfig.json",
];

const EXPECTED = {
  typescript: [
    ".gitignore",
    "cinecode.config.ts",
    "main.ts",
    "media/README.md",
    "output/.gitkeep",
    "package.json",
    "README.md",
    "src/components/title-card.ts",
    "src/scenes/intro.ts",
    "src/timelines/main.ts",
    "tsconfig.json",
  ],
  javascript: [
    ".gitignore",
    "cinecode.config.js",
    "jsconfig.json",
    "main.js",
    "media/README.md",
    "output/.gitkeep",
    "package.json",
    "README.md",
    "src/components/title-card.js",
    "src/scenes/intro.js",
    "src/timelines/main.js",
  ],
};

const LANGUAGES = ["typescript", "javascript"];

function filesUnder(dir) {
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) found.push(rel);
    }
  };
  walk(dir, "");
  return found.sort();
}

function setDifference(actual, expected) {
  const actualSet = new Set(actual);
  return expected.filter((file) => !actualSet.has(file));
}

function unifiedDiff(label, expected, actual) {
  const before = expected.split("\n");
  const after = actual.split("\n");
  const lcs = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push(` ${before[i]}`);
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push(`+${after[j]}`);
      j += 1;
    } else {
      lines.push(`-${before[i]}`);
      i += 1;
    }
  }
  return [
    `--- ${label}`,
    `+++ ${label} (generated)`,
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...lines,
  ].join("\n");
}

function readCanonical(rel) {
  return readFileSync(path.join(canonicalDir, rel), "utf8");
}

function buildVariants() {
  const withExt = (rel, ext) => readCanonical(rel).replaceAll("{{EXT}}", ext);
  const shared = {
    ".gitignore": readCanonical(".gitignore"),
    "README.md": readCanonical("README.md"),
    "media/README.md": readCanonical("media/README.md"),
    "output/.gitkeep": readCanonical("output/.gitkeep"),
    "src/components/title-card.ts": readCanonical("src/components/title-card.ts"),
  };

  const tsconfig = readCanonical("tsconfig.json");
  const jsconfig = readCanonical("jsconfig.json");

  const jsSyntaxCheck = ["main.js", "src/scenes/intro.js", "src/timelines/main.js", "src/components/title-card.js"]
    .map((file) => `node --check ${file}`)
    .join(" && ");
  const jsPkg = JSON.parse(readCanonical("package.json").replaceAll("{{TYPECHECK_SCRIPT}}", jsSyntaxCheck));
  delete jsPkg.devDependencies?.typescript;
  delete jsPkg.devDependencies?.["typescript-eslint"];

  const typescript = {
    ".gitignore": shared[".gitignore"],
    "cinecode.config.ts": withExt("cinecode.config.ts", "ts"),
    "main.ts": withExt("main.ts", "ts"),
    "package.json": readCanonical("package.json").replaceAll("{{TYPECHECK_SCRIPT}}", "tsc --noEmit"),
    "tsconfig.json": tsconfig,
    "README.md": shared["README.md"],
    "media/README.md": shared["media/README.md"],
    "output/.gitkeep": shared["output/.gitkeep"],
    "src/components/title-card.ts": shared["src/components/title-card.ts"],
    "src/scenes/intro.ts": withExt("src/scenes/intro.ts", "ts"),
    "src/timelines/main.ts": withExt("src/timelines/main.ts", "ts"),
  };

  const javascript = {
    ".gitignore": shared[".gitignore"],
    "cinecode.config.js": withExt("cinecode.config.ts", "js"),
    "main.js": withExt("main.ts", "js"),
    "package.json": JSON.stringify(jsPkg, null, 2) + "\n",
    "jsconfig.json": jsconfig,
    "README.md": shared["README.md"],
    "media/README.md": shared["media/README.md"],
    "output/.gitkeep": shared["output/.gitkeep"],
    "src/components/title-card.js": shared["src/components/title-card.ts"],
    "src/scenes/intro.js": withExt("src/scenes/intro.ts", "js"),
    "src/timelines/main.js": withExt("src/timelines/main.ts", "js"),
  };

  return { typescript, javascript };
}

function assertExactSet(label, actual, expected) {
  const missing = setDifference(expected, actual);
  const extra = setDifference(actual, expected);
  if (missing.length === 0 && extra.length === 0) return;
  const parts = [`template file set mismatch for ${label}`];
  if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`unexpected: ${extra.join(", ")}`);
  parts.push(`fix: update templates/${label} or the EXPECTED list in scripts/generate-templates.mjs.`);
  throw new Error(parts.join("\n"));
}

function normalizedPackage(content) {
  const pkg = JSON.parse(content);
  if (pkg.scripts) delete pkg.scripts.typecheck;
  if (pkg.devDependencies) {
    delete pkg.devDependencies.typescript;
    delete pkg.devDependencies["typescript-eslint"];
  }
  return JSON.stringify(pkg);
}

function assertVariantParity(variants) {
  const problems = [];
  const typescript = variants.typescript;
  const javascript = variants.javascript;
  const counterpart = (rel) => (rel === "tsconfig.json" ? "jsconfig.json" : rel.replace(/\.ts$/, ".js"));

  for (const rel of Object.keys(typescript)) {
    const jsRel = counterpart(rel);
    if (!(jsRel in javascript)) {
      problems.push(`javascript variant is missing ${jsRel}, the counterpart of typescript/${rel}`);
      continue;
    }
    if (rel === "tsconfig.json") continue;
    const tsContent = typescript[rel];
    const jsContent = javascript[jsRel];
    let same;
    if (rel === "package.json") {
      same = normalizedPackage(tsContent) === normalizedPackage(jsContent);
    } else if (rel.endsWith(".ts")) {
      same = tsContent.replaceAll(".ts", ".js") === jsContent;
    } else {
      same = tsContent === jsContent;
    }
    if (!same) {
      problems.push(
        `javascript/${jsRel} differs from typescript/${rel} outside the allowed extension, tsconfig and typecheck-script differences`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`template variant parity failed:\n${problems.join("\n")}`);
  }
}

export function generateVariants() {
  const canonicalActual = filesUnder(canonicalDir);
  assertExactSet("canonical", canonicalActual, CANONICAL_FILES);
  const variants = buildVariants();
  for (const language of LANGUAGES) assertExactSet(language, Object.keys(variants[language]).sort(), EXPECTED[language]);
  assertVariantParity(variants);
  return variants;
}

export function writeTemplates(outRoot) {
  const variants = generateVariants();
  for (const language of LANGUAGES) {
    for (const [rel, content] of Object.entries(variants[language])) {
      const target = path.join(outRoot, language, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
  }
  return outRoot;
}

export function compareTemplates(generatedRoot, referenceRoot = templatesRoot) {
  const problems = [];
  for (const language of LANGUAGES) {
    const referenceDir = path.join(referenceRoot, language);
    const generatedDir = path.join(generatedRoot, language);
    const reference = filesUnder(referenceDir);
    const generated = filesUnder(generatedDir);
    const missing = setDifference(reference, generated);
    const extra = setDifference(generated, reference);
    for (const rel of missing) problems.push(`missing from build output: ${language}/${rel}`);
    for (const rel of extra) problems.push(`unexpected in build output: ${language}/${rel}`);
    for (const rel of reference) {
      if (!generated.includes(rel)) continue;
      const expected = readFileSync(path.join(referenceDir, rel), "utf8");
      const actual = readFileSync(path.join(generatedDir, rel), "utf8");
      if (expected !== actual) problems.push(unifiedDiff(`${language}/${rel}`, expected, actual));
    }
  }
  return problems;
}

export function checkTemplates() {
  const scratch = mkdtempSync(path.join(tmpdir(), "cinecode-templates-"));
  try {
    writeTemplates(scratch);
    return compareTemplates(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  if (process.argv.includes("--check")) {
    const problems = checkTemplates();
    if (problems.length > 0) {
      console.error(`template drift detected:\n${problems.join("\n")}`);
      process.exit(1);
    }
    console.log("templates match the canonical sources");
  } else {
    const outIndex = process.argv.indexOf("--out");
    const outDir = outIndex === -1 ? undefined : process.argv[outIndex + 1];
    if (!outDir) {
      console.error("usage: generate-templates.mjs --out <dir> | --check");
      process.exit(2);
    }
    writeTemplates(path.resolve(outDir));
    console.log(`templates written to ${path.resolve(outDir)}`);
  }
}
