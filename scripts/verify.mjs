import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, "packages", entry.name, "scripts", "build.mjs")))
  .map((entry) => path.join(root, "packages", entry.name))
  .sort();

execFileSync(process.execPath, [path.join(root, "scripts", "check-source.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-errors.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-registry.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-options.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-preflight.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-envelope.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-surface.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-config-consumers.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-config-load.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-manifest-contract.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-entry-resolution.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-builder-semantics.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-audio-contract.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-media-policy.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-output-plans.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-render-unification.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-validation-engine.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-doctor-health.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-maintenance.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-first-run.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-preview-host.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-preview-engine.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-dev-incremental.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-binary-decode.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-resources.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-surface-prune.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-version-lockstep.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "acceptance-sweep.mjs")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(process.execPath, [path.join(root, "scripts", "check-docs.mjs")], {
  cwd: root,
  stdio: "inherit",
});

for (const pkg of packages) {
  const build = path.join(pkg, "scripts", "build.mjs");
  execFileSync(process.execPath, [build], { cwd: pkg, stdio: "inherit" });
}

console.log(`verify ok: ${packages.length} packages checked`);
