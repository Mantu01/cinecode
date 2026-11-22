import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [path.join(root, ".turbo")];

for (const entry of readdirSync(path.join(root, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = path.join(root, "packages", entry.name);
  for (const name of ["dist", "dist-test", ".turbo"]) targets.push(path.join(pkg, name));
}

let removed = 0;
for (const target of targets) {
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  removed += 1;
}
console.log(`clean ok: removed ${removed} build output director${removed === 1 ? "y" : "ies"}`);
