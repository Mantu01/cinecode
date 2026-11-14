import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync, cpSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

rmSync(path.join(pkg, "dist"), { recursive: true, force: true });

function emit(extraArgs, label) {
  const result = spawnSync("tsc", ["-p", "tsconfig.build.json", ...extraArgs], {
    cwd: pkg,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`build: ${label} emit failed`);
    process.exit(result.status ?? 1);
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

function copyTemplates() {
  const src = path.join(pkg, "templates");
  const destEsm = path.join(pkg, "dist", "esm", "templates");
  const destCjs = path.join(pkg, "dist", "cjs", "templates");
  cpSync(src, destEsm, { recursive: true });
  cpSync(src, destCjs, { recursive: true });
}

emit(["--module", "nodenext", "--moduleResolution", "nodenext", "--outDir", "dist/esm"], "esm");
emit(["--module", "nodenext", "--moduleResolution", "nodenext", "--outDir", "dist/cjs"], "cjs");
renameCjs(path.join(pkg, "dist", "cjs"));
copyTemplates();

const binEntry = path.join(pkg, "dist", "esm", "index.js");
const binSource = readFileSync(binEntry, "utf8");
if (!binSource.startsWith("#!")) {
  writeFileSync(binEntry, `#!/usr/bin/env node\n${binSource}`, "utf8");
}
