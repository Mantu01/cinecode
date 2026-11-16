import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

export function cleanDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (existsSync(dir)) fail(`could not clean ${dir}`);
}

export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function dirSize(dir) {
  return listFiles(dir).reduce((total, file) => total + statSync(file).size, 0);
}

function walkStrings(node, out) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") Object.values(node).forEach((value) => walkStrings(value, out));
  return out;
}

export function manifestTargets(manifest) {
  const targets = walkStrings(manifest.exports ?? {}, []);
  if (manifest.main) targets.push(manifest.main);
  if (manifest.module) targets.push(manifest.module);
  if (manifest.types) targets.push(manifest.types);
  targets.push(...walkStrings(manifest.bin ?? {}, []));
  return [...new Set(targets.map((target) => target.replace(/^\.\//, "")))];
}

export function declarationEntriesOf(manifest) {
  return manifestTargets(manifest).filter((target) => target.endsWith(".d.ts"));
}

export function assertTargets(pkg, manifest) {
  for (const target of manifestTargets(manifest)) {
    const full = path.resolve(pkg, target);
    if (!full.startsWith(pkg + path.sep)) fail(`manifest target escapes the package: ${target}`);
    if (!existsSync(full)) fail(`manifest target missing from the build: ${target}`);
  }
  if (manifest.type === "module" && existsSync(path.join(pkg, "dist", "cjs"))) {
    fail("dist/cjs emitted by an ESM-only package");
  }
  for (const file of listFiles(path.join(pkg, "src"))) {
    if (/\.(js|cjs|mjs)$/.test(file)) fail(`build output leaked into src: ${path.relative(pkg, file)}`);
  }
}

const specifiers = (source) =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)"([^"]+)"/gm)].map((match) => match[1]);

export function pruneDeclarations(pkg, entries) {
  const keep = new Set();
  const pending = entries.map((entry) => path.resolve(pkg, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (keep.has(file)) continue;
    if (!existsSync(file)) fail(`referenced module missing: ${path.relative(pkg, file)}`);
    keep.add(file);
    if (!file.endsWith(".d.ts")) continue;
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      pending.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".d.ts")));
    }
  }
  let removed = 0;
  for (const file of listFiles(path.join(pkg, "dist"))) {
    if (file.endsWith(".d.ts") && !keep.has(file)) {
      rmSync(file);
      removed += 1;
    }
  }
  return removed;
}

export function packFiles(pkg) {
  const result = spawnSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: pkg,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) fail(`npm pack --dry-run failed: ${(result.stderr ?? "").trim()}`);
  const [report] = JSON.parse(result.stdout);
  return { files: report.files.map((file) => file.path), size: report.size };
}

const FORBIDDEN = [
  /^src\//,
  /^scripts\//,
  /^tests?\//,
  /^dist-test\//,
  /^coverage\//,
  /^verify-cache\//,
  /node_modules\//,
  /\.map$/,
  /^tsconfig/,
  /^\./,
];

export function assertPack(pkg, manifest, files) {
  const present = new Set(files);
  const required = manifestTargets(manifest);
  for (const entry of manifest.files ?? []) {
    const shipped = entry.replace(/\/$/, "");
    if (/[*?]/.test(shipped)) continue;
    const full = path.join(pkg, shipped);
    if (entry.endsWith("/") || (existsSync(full) && statSync(full).isDirectory())) {
      if (!files.some((file) => file.startsWith(`${shipped}/`))) fail(`packed artifact is missing directory ${shipped}`);
    } else required.push(shipped);
  }
  for (const file of required) {
    if (!present.has(file)) fail(`packed artifact is missing ${file}`);
  }
  for (const file of files) {
    if (FORBIDDEN.some((pattern) => pattern.test(file))) fail(`packed artifact contains forbidden file ${file}`);
  }
}

export function report(label, startedAt, dirs, pack) {
  const bytes = dirs.reduce((total, dir) => total + dirSize(dir), 0);
  const count = dirs.reduce((total, dir) => total + listFiles(dir).length, 0);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `${label}: ${seconds}s, ${(bytes / 1048576).toFixed(2)} MB, ${count} files, tarball ${(pack.size / 1024).toFixed(0)} KB (${pack.files.length} entries)`,
  );
}
