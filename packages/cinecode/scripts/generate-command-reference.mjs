import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const docsDir = resolve(packageRoot, "..", "..", "docs");

const { COMMANDS } = await import(pathToFileURL(resolve(packageRoot, "dist/esm/cli/command-registry.js")).href);
const { EXIT_CODES, EXIT_CODE_MEANINGS } = await import(pathToFileURL(resolve(packageRoot, "dist/esm/cli/exit-codes.js")).href);

function escapeMd(text) {
  if (!text) return "";
  return String(text).replace(/\|/g, "\\|");
}

export async function generateCommandReferenceMarkdown() {
  const lines = [];

  lines.push("# CLI Command Reference");
  lines.push("");
  lines.push("<!-- Generated automatically from CLI command metadata. Do not edit manually. -->");
  lines.push("");
  lines.push("Cinecode provides 34 local CLI commands for project authoring, diagnostics, rendering, and asset generation.");
  lines.push("");
  lines.push("## Commands Overview");
  lines.push("");
  lines.push("| Command | Summary | Example |");
  lines.push("| --- | --- | --- |");

  for (const spec of COMMANDS) {
    lines.push(`| [\`cinecode ${spec.name}\`](#${spec.name.replace(/[:]/g, "")}) | ${escapeMd(spec.summary)} | \`${escapeMd(spec.example)}\` |`);
  }

  lines.push("");
  lines.push("## Command Details");
  lines.push("");

  for (const spec of COMMANDS) {
    const cmd = await spec.load();
    const anchor = spec.name.replace(/[:]/g, "");
    lines.push(`### \`cinecode ${spec.name}\` {#${anchor}}`);
    lines.push("");
    lines.push(cmd.description() || spec.summary);
    lines.push("");
    lines.push(`**Usage:** \`${spec.example}\``);
    lines.push("");

    if (cmd.options && cmd.options.length > 0) {
      lines.push("#### Options");
      lines.push("");
      lines.push("| Option | Description | Default |");
      lines.push("| --- | --- | --- |");
      for (const opt of cmd.options) {
        const def = opt.defaultValue !== undefined ? String(opt.defaultValue) : "—";
        lines.push(`| \`${escapeMd(opt.flags)}\` | ${escapeMd(opt.description)} | \`${escapeMd(def)}\` |`);
      }
      lines.push("");
    }
  }

  lines.push("## Exit Codes");
  lines.push("");
  lines.push("All CLI commands exit with standard codes indicating outcome:");
  lines.push("");
  lines.push("| Code | Status | Meaning |");
  lines.push("| --- | --- | --- |");

  for (const [name, code] of Object.entries(EXIT_CODES)) {
    const meaning = EXIT_CODE_MEANINGS[name] || "";
    lines.push(`| \`${code}\` | **${name}** | ${escapeMd(meaning)} |`);
  }

  lines.push("");
  return lines.join("\n");
}

mkdirSync(docsDir, { recursive: true });
const md = await generateCommandReferenceMarkdown();
writeFileSync(resolve(docsDir, "command-reference.md"), md, "utf8");
console.log("command-reference: wrote docs/command-reference.md");
