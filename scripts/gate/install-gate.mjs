import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const full = process.argv.includes("--full");
const build = !process.argv.includes("--no-build");

const COMMANDS = [
  "render",
  "still",
  "preview",
  "dev",
  "edit",
  "sync",
  "compare",
  "benchmark",
  "upgrade",
  "template",
  "doctor",
  "health",
  "check",
  "canvas",
  "render-multi",
];

const FIXTURE = `export default {
  name: "gate-tiny",
  width: 64,
  height: 32,
  fps: 1,
  background: "#112233",
  audio: {},
  rootTimeline: { tracks: [] },
};
`;

const results = [];
let workDir = "";

function record(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function shell(command, args, options = {}) {
  const needsShell = process.platform === "win32" && (command === "npm" || /\.(cmd|bat)$/.test(command));
  const result = spawnSync(command, args, { encoding: "utf8", shell: needsShell, ...options });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function npm(args, cwd, cacheDir) {
  const cache = cacheDir ? ["--cache", cacheDir] : [];
  return shell("npm", [...args, "--no-audit", "--no-fund", "--loglevel", "error", ...cache], { cwd });
}

function parseVersion(version) {
  return version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
}

function atLeast(actual, minimum) {
  const a = parseVersion(actual);
  const m = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) > (m[index] ?? 0)) return true;
    if ((a[index] ?? 0) < (m[index] ?? 0)) return false;
  }
  return true;
}

function engineMinimum(range) {
  return range.replace(/^>=\s*/, "").trim();
}

function pack(pkgDir, destination) {
  const result = shell("npm", ["pack", "--json", "--pack-destination", destination, "--ignore-scripts"], { cwd: pkgDir });
  assert(result.status === 0, `npm pack failed in ${pkgDir}: ${result.stderr.trim()}`);
  const [report] = JSON.parse(result.stdout);
  return {
    tarball: path.join(destination, report.filename),
    size: report.size,
    files: report.files.map((file) => file.path),
    unpackedSize: report.unpackedSize,
    version: JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version,
  };
}

function binPath(dir, name) {
  return path.join(dir, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function pngSize(file) {
  const buffer = readFileSync(file);
  assert(buffer.length > 0, "render output is empty");
  assert(buffer.slice(1, 4).toString("ascii") === "PNG", "render output is not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

console.log(`gate: ${full ? "full (isolated npm cache)" : "local (shared npm cache)"} on node ${process.version}`);

if (build) {
  for (const pkg of ["packages/cinecode", "packages/create-cinecode"]) {
    const result = shell(process.execPath, ["scripts/build.mjs"], { cwd: path.join(repo, pkg) });
    assert(result.status === 0, `build failed for ${pkg}: ${result.stderr.trim()}`);
  }
}

workDir = mkdtempSync(path.join(tmpdir(), "cinecode-gate-"));
assert(!path.resolve(workDir).startsWith(repo), "gate directory must be outside the workspace");

const tarballDir = path.join(workDir, "tarballs");
const projectDir = path.join(workDir, "project");
const cacheDir = full ? path.join(workDir, "npm-cache") : "";
for (const dir of [tarballDir, projectDir]) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "gate-project", private: true, type: "module" }, null, 2));

const framework = pack(path.join(repo, "packages/cinecode"), tarballDir);
const scaffolder = pack(path.join(repo, "packages/create-cinecode"), tarballDir);

console.log(
  `artifact: cinecode ${(framework.size / 1024).toFixed(0)} KB / ${framework.files.length} files, create-cinecode ${(scaffolder.size / 1024).toFixed(0)} KB / ${scaffolder.files.length} files`,
);

const installedManifest = () => JSON.parse(readFileSync(path.join(projectDir, "node_modules", "cinecode", "package.json"), "utf8"));

record("install from tarballs", () => {
  const startedAt = Date.now();
  const result = npm(["install", framework.tarball, scaffolder.tarball, "--no-package-lock"], projectDir, cacheDir);
  assert(result.status === 0, `install failed: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
  const log = `${result.stdout}\n${result.stderr}`;
  assert(!/gyp ERR|node-gyp rebuild|could not find a version/i.test(log), "install attempted a native compilation step");
  assert(!existsSync(path.join(projectDir, "pnpm-workspace.yaml")), "gate project must not be workspace linked");
  const installed = path.join(projectDir, "node_modules", "cinecode");
  assert(existsSync(installed) && !statSync(installed).isSymbolicLink(), "installed package is a link, not a tarball install");
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s, ${(framework.unpackedSize / 1048576).toFixed(1)} MB unpacked`;
});

record("engine range matches runner", () => {
  const range = installedManifest().engines?.node;
  assert(range, "installed manifest declares no engines.node");
  assert(atLeast(process.version, engineMinimum(range)), `runner ${process.version} does not satisfy engines.node ${range}`);
  const scaffoldRange = JSON.parse(readFileSync(path.join(projectDir, "node_modules", "create-cinecode", "package.json"), "utf8")).engines?.node;
  assert(scaffoldRange === range, `scaffolder engines.node ${scaffoldRange} disagrees with framework ${range}`);
  return range;
});

record("cli reports version", () => {
  const result = shell(binPath(projectDir, "cinecode"), ["--version"], { cwd: projectDir });
  assert(result.status === 0, `version exited ${result.status}: ${result.stderr.trim()}`);
  assert(result.stdout.trim() === framework.version, `version ${result.stdout.trim()} != manifest ${framework.version}`);
  return result.stdout.trim();
});

record("cli help lists documented commands", () => {
  const result = shell(binPath(projectDir, "cinecode"), ["--help"], { cwd: projectDir });
  assert(result.status === 0, `help exited ${result.status}`);
  const missing = COMMANDS.filter((command) => !new RegExp(`^\\s+(?:${command})\\b`, "m").test(result.stdout));
  assert(missing.length === 0, `help is missing: ${missing.join(", ")}`);
  return `${COMMANDS.length} commands`;
});

record("public api loads", () => {
  const result = shell(
    process.execPath,
    ["--input-type=module", "-e", "const m = await import('cinecode'); console.log(['defineConfig','defineMain','defineScene'].filter((k) => typeof m[k] !== 'function').join(',') || 'ok')"],
    { cwd: projectDir },
  );
  assert(result.status === 0, `import failed: ${result.stderr.trim().slice(0, 300)}`);
  assert(result.stdout.trim() === "ok", `missing exports: ${result.stdout.trim()}`);
  return "defineConfig, defineMain, defineScene";
});

record("manifest resolves through specifier", () => {
  const result = shell(process.execPath, ["--input-type=module", "-e", "console.log(import.meta.resolve('cinecode/package.json'))"], { cwd: projectDir });
  assert(result.status === 0, `resolve failed: ${result.stderr.trim().slice(0, 300)}`);
  const resolved = fileURLToPath(result.stdout.trim());
  assert(path.resolve(resolved) === path.join(projectDir, "node_modules", "cinecode", "package.json"), `resolved unexpected path ${resolved}`);
  return "cinecode/package.json";
});

record("commonjs require blocked by ESM-only policy", () => {
  const result = shell(process.execPath, ["-e", "try { require('cinecode'); console.log('loaded') } catch (error) { console.log(error.code) }"], { cwd: projectDir });
  assert(result.stdout.trim() === "ERR_PACKAGE_PATH_NOT_EXPORTED", `require returned ${result.stdout.trim()}`);
  return "ERR_PACKAGE_PATH_NOT_EXPORTED";
});

record("shipped schema parses", () => {
  const schemaPath = path.join(projectDir, "node_modules", "cinecode", "cinecode.schema.json");
  assert(existsSync(schemaPath), "installed package ships no cinecode.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert(typeof schema.$id === "string" && Object.keys(schema).length > 1, "shipped schema is not a valid JSON schema document");
  return schema.$id;
});

record("one-frame render produces output", () => {
  writeFileSync(path.join(projectDir, "composition.js"), FIXTURE);
  const out = path.join(projectDir, "out", "frame.png");
  mkdirSync(path.dirname(out), { recursive: true });
  const render = shell(binPath(projectDir, "cinecode"), ["still", "--props", "./composition.js", "-f", "0", "-o", out], { cwd: projectDir });
  assert(render.status === 0, `render exited ${render.status}: ${(render.stderr || render.stdout).trim().slice(0, 400)}`);
  assert(existsSync(out), "render exited zero without producing an output file");
  const { width, height } = pngSize(out);
  assert(width === 64 && height === 32, `rendered ${width}x${height}, expected 64x32`);
  const frames = readdirSync(path.join(projectDir, "out")).filter((file) => file.endsWith(".png")).length;
  assert(frames === 1, `expected 1 frame, found ${frames}`);
  return `1 frame, 64x32, ${statSync(out).size} bytes`;
});

record("scaffolder runs without workspace access", () => {
  const result = shell(binPath(projectDir, "create-cinecode"), ["--version"], { cwd: projectDir });
  assert(result.status === 0, `scaffolder version exited ${result.status}`);
  assert(result.stdout.trim() === scaffolder.version, `scaffolder version ${result.stdout.trim()} != ${scaffolder.version}`);
  assert(
    scaffolder.files.some((file) => file.startsWith("dist/esm/templates/")),
    "scaffolder tarball carries no templates",
  );
  const templates = path.join(projectDir, "node_modules", "create-cinecode", "dist", "esm", "templates");
  assert(existsSync(path.join(templates, "typescript")), "installed scaffolder has no typescript template");
  return `${result.stdout.trim()}, templates present`;
});

record("scaffolded project pins a registry range", () => {
  const target = path.join(workDir, "scaffolded");
  const result = shell(binPath(projectDir, "create-cinecode"), [target, "--ts", "--skip-install", "--no-git"], { cwd: projectDir });
  assert(result.status === 0, `scaffold exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
  for (const file of ["package.json", "cinecode.config.ts", "main.ts", path.join("src", "scenes", "intro.ts")]) {
    assert(existsSync(path.join(target, file)), `scaffold is missing ${file}`);
  }
  const dependency = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8")).dependencies?.cinecode ?? "";
  assert(/^\^?\d+\.\d+\.\d+/.test(dependency), `scaffolded dependency is not a registry range: ${dependency}`);
  return dependency;
});

rmSync(workDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`gate: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
