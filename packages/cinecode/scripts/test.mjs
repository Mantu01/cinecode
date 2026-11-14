import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const outDir = path.join(pkg, "dist-test");

const emit = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", "dist-test", "--noEmit", "false"], {
  cwd: pkg,
  stdio: "inherit",
  shell: true,
});

if (emit.status !== 0) {
  console.error("test: emit failed");
  process.exit(emit.status ?? 1);
}

function collectTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") {
        for (const file of readdirSync(full)) {
          if (file.endsWith(".test.js") && !file.endsWith(".d.test.js")) found.push(path.join(full, file));
        }
      } else {
        found.push(...collectTests(full));
      }
    }
  }
  return found;
}

const testFiles = collectTests(outDir);

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

const run = spawnSync(
  process.execPath,
  ["--test", ...testFiles],
  { stdio: "inherit" },
);

process.exitCode = run.status ?? 1;
