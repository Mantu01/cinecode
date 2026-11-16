import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

rmSync(path.join(pkg, "dist"), { recursive: true, force: true });

const outDir = path.join(pkg, "dist", "esm");
const tscBin = require.resolve("typescript/bin/tsc");
try {
  execSync(
    `"${process.execPath}" "${tscBin}" -p "${path.join(pkg, "tsconfig.build.json").replace(/\\/g, "/")}" --outDir "${outDir.replace(/\\/g, "/")}" --module NodeNext --moduleResolution NodeNext`,
    { cwd: pkg, stdio: "inherit" },
  );
} catch (err) {
  console.error("esm emit failed");
  process.exit(err.status ?? 1);
}

writeFileSync(
  path.join(outDir, "cli", "main.js"),
  `#!/usr/bin/env node\n${readFileSync(path.join(outDir, "cli", "main.js"), "utf8")}`,
  "utf8",
);

const pkgJsonPath = path.join(pkg, "package.json");
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
pkgJson.exports =
  pkgJson.exports && typeof pkgJson.exports === "object" && !Array.isArray(pkgJson.exports)
    ? Object.fromEntries(
        Object.entries(pkgJson.exports).map(([k, v]) => [
          k,
          typeof v === "string" ? `file:${v}` : v,
        ]),
      )
    : pkgJson.exports;
writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf8");

console.log("esm build OK");
