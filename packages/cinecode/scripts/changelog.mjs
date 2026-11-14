import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");

export function generateChangelog(version = "1.0.0") {
  let commits = "";
  try {
    commits = execSync("git log --oneline -n 50", { encoding: "utf8" });
  } catch {
    commits = "feat: initial 1.0.0 release\n";
  }

  const added = [];
  const fixed = [];
  const security = [];
  const other = [];

  for (const line of commits.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const msg = trimmed.replace(/^[a-f0-9]+\s+/, "");
    if (msg.startsWith("feat:")) added.push(msg.replace(/^feat:\s*/, ""));
    else if (msg.startsWith("fix:")) fixed.push(msg.replace(/^fix:\s*/, ""));
    else if (msg.startsWith("security:")) security.push(msg.replace(/^security:\s*/, ""));
    else other.push(msg);
  }

  const date = new Date().toISOString().substring(0, 10);
  let md = `## [${version}] - ${date}\n\n`;

  if (added.length > 0) {
    md += `### Added\n` + added.map((m) => `- ${m}`).join("\n") + "\n\n";
  }
  if (fixed.length > 0) {
    md += `### Fixed\n` + fixed.map((m) => `- ${m}`).join("\n") + "\n\n";
  }
  if (security.length > 0) {
    md += `### Security\n` + security.map((m) => `- ${m}`).join("\n") + "\n\n";
  }

  const changelogPath = path.join(pkgDir, "CHANGELOG.md");
  let existing = "";
  if (fs.existsSync(changelogPath)) {
    existing = fs.readFileSync(changelogPath, "utf8");
  } else {
    existing = "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
  }

  const updated = existing.includes(`[${version}]`) ? existing : existing.replace("# Changelog\n\n", `# Changelog\n\n${md}`);
  fs.writeFileSync(changelogPath, updated, "utf8");
  return updated;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] || "1.0.0";
  generateChangelog(version);
  console.log(`Generated CHANGELOG.md for v${version}`);
}
