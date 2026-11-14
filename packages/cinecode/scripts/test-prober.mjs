#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const outDir = path.join(pkg, "dist-test");

const build = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", "dist-test"], {
  cwd: pkg,
  shell: true,
});
if (build.status !== 0) {
  console.error("build:cinecode emit failed");
  process.exit(build.status ?? 1);
}

function collect(dir) {
  const list = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") list.push(...collect(full));
      else list.push(...collect(full));
    } else if (entry.name.endsWith(".test.mjs")) {
      list.push(full);
    }
  }
  return list;
}

const tests = collect(path.join(pkg, "src")).concat(collect(path.join(pkg, "scripts")));
console.log(`collected ${tests.length} test entries`);
console.log(tests.slice(0, 20).join("\n"));
