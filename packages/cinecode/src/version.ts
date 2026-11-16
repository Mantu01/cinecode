import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function findPackageJson(): string {
  let dir = moduleDir;
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(moduleDir, "../../package.json");
}

export const CINECODE_VERSION = JSON.parse(readFileSync(findPackageJson(), "utf8"))
  .version as string;
