import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const distDir = path.join(pkgDir, "dist");

export function generateChecksums() {
  if (!fs.existsSync(distDir)) {
    throw new Error("Dist directory not found. Run build first.");
  }

  const files = [];
  function collect(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) collect(full);
      else if (ent.isFile() && !ent.name.endsWith(".map") && ent.name !== "SHA256SUMS") {
        files.push(full);
      }
    }
  }
  collect(distDir);

  const lines = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const hash = createHash("sha256").update(buf).digest("hex");
    const rel = path.relative(distDir, f).replace(/\\/g, "/");
    lines.push(`${hash}  ${rel}`);
  }

  const checksums = lines.join("\n") + "\n";
  fs.writeFileSync(path.join(distDir, "SHA256SUMS"), checksums, "utf8");
  return checksums;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sums = generateChecksums();
  console.log("Generated dist/SHA256SUMS");
}
