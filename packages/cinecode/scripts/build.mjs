import { execSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

rmSync(path.join(pkg, "dist"), { recursive: true, force: true });

const schemaResult = spawnSync(process.execPath, [path.join(here, "generate-schema.mjs")], { cwd: pkg, stdio: "inherit" });
if (schemaResult.status !== 0) {
  console.error("build: schema generation failed");
  process.exit(schemaResult.status ?? 1);
}

function emit(extraArgs, label) {
  const tscCmd =
    process.platform === "win32"
      ? path.resolve(pkg, "..", "..", "node_modules", ".bin", "tsc.cmd")
      : path.resolve(pkg, "..", "..", "node_modules", ".bin", "tsc");
  try {
    execSync(
      `"${tscCmd}" -p "${path.join(pkg, "tsconfig.build.json")}" ${extraArgs.join(" ")}`,
      { cwd: pkg, stdio: "inherit" },
    );
  } catch (err) {
    console.error(`build: ${label} emit failed`);
    process.exit(err.status ?? 1);
  }
}

function renameCjs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      renameCjs(full);
      continue;
    }
    if (entry.name.endsWith(".js.map")) {
      renameSync(full, full.replace(/\.js\.map$/, ".cjs.map"));
    } else if (entry.name.endsWith(".js")) {
      renameSync(full, full.replace(/\.js$/, ".cjs"));
      if (entry.name.endsWith(".d.js") === false) {
      }
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith(".cjs.map")) {
      const mapPath = path.join(dir, entry.name);
      const map = JSON.parse(readFileSync(mapPath, "utf8"));
      if (map.file) {
        map.file = map.file.replace(/\.js$/, ".cjs");
        writeFileSync(mapPath, JSON.stringify(map));
      }
    } else if (entry.name.endsWith(".cjs") && !entry.name.endsWith(".d.cjs")) {
      const file = path.join(dir, entry.name);
      const src = readFileSync(file, "utf8");
      writeFileSync(file, src.replace(/\/\/# sourceMappingURL=(.*)\.js\.map/g, "//# sourceMappingURL=$1.cjs.map"));
    }
  }
}

emit(["--module", "NodeNext", "--moduleResolution", "NodeNext", "--outDir", "dist/esm"], "esm");
emit(["--module", "NodeNext", "--moduleResolution", "NodeNext", "--outDir", "dist/cjs"], "cjs");
renameCjs(path.join(pkg, "dist", "cjs"));

const binEntry = path.join(pkg, "dist", "esm", "cli", "main.js");
const binSource = readFileSync(binEntry, "utf8");
if (!binSource.startsWith("#!")) {
  writeFileSync(binEntry, `#!/usr/bin/env node\n${binSource}`, "utf8");
}
