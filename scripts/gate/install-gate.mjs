import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const full = process.argv.includes("--full");
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const cacheDir = path.join(root, ".turbo", "npm-cache");
const packages = readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, "packages", entry.name, "scripts", "build.mjs")))
  .map((entry) => path.join(root, "packages", entry.name))
  .sort();

if (full) {
  for (const pkg of packages) {
    execFileSync(process.execPath, [path.join(pkg, "scripts", "build.mjs")], {
      cwd: pkg,
      stdio: "inherit",
    });
  }
}

function packedFiles(pkg) {
  const isWin = process.platform === "win32";
  const cmd = isWin && existsSync(npmCli) ? process.execPath : "npm";
  const args = isWin && existsSync(npmCli)
    ? [npmCli, "pack", "--dry-run", "--json", "--cache", cacheDir]
    : ["pack", "--dry-run", "--json", "--cache", cacheDir];
  const output = execFileSync(cmd, args, { cwd: pkg, encoding: "utf8" });
  const report = JSON.parse(output.slice(output.indexOf("[")));
  return new Set(report[0].files.map((file) => file.path));
}

const problems = [];
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
  let packed;
  try {
    packed = packedFiles(pkg);
  } catch (error) {
    problems.push(`${manifest.name}: pack --dry-run failed (${error.message.split("\n")[0]})`);
    continue;
  }
  for (const entry of manifest.files ?? []) {
    const isDir = entry.endsWith("/") || statSync(path.join(pkg, entry), { throwIfNoEntry: false })?.isDirectory();
    const prefix = entry.endsWith("/") ? entry : `${entry}/`;
    const found = isDir
      ? [...packed].some((file) => file.startsWith(prefix))
      : packed.has(entry);
    if (!found) problems.push(`${manifest.name}: packed artifact is missing "${entry}"`);
  }
  for (const bin of Object.values(manifest.bin ?? {})) {
    if (!packed.has(bin.replace(/^\.\//, ""))) {
      problems.push(`${manifest.name}: packed artifact is missing bin target "${bin}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.join("\n")}\nfix: align package.json "files"/"bin" with the build output.`);
  process.exit(1);
}
console.log(`artifact gate ok: ${packages.length} packages`);
