import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

console.log("Updating and verifying visual golden fixtures...");

const emit = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", "dist-test", "--noEmit", "false"], {
  cwd: pkg,
  stdio: "inherit",
  shell: true,
});

if (emit.status !== 0) {
  console.error("update-goldens: compilation failed");
  process.exit(emit.status ?? 1);
}

const testPath = path.join(pkg, "dist-test/renderer/__tests__/golden-output.test.js");
const run = spawnSync(process.execPath, ["--test", testPath], {
  cwd: pkg,
  stdio: "inherit",
});

if (run.status !== 0) {
  console.error("update-goldens: visual fixtures failed tolerance check");
  process.exit(run.status ?? 1);
}

console.log("Visual golden fixtures verified and up to date.");
