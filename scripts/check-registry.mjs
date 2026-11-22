import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distRegistry = path.join(cinecodeDir, "dist", "esm", "cli", "command-registry.js");

if (!existsSync(distRegistry)) {
  execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
    cwd: cinecodeDir,
    stdio: "inherit",
  });
}

const {
  COMMANDS,
  serializeRegistry,
  executeCommandWithGate,
  formatHelpText,
  findCommand,
} = await import(pathToFileURL(distRegistry).href);

let errors = 0;
function fail(msg) {
  console.error(`check-registry error: ${msg}`);
  errors++;
}

// 1. Static check: no .option( outside command-registry.ts and program.ts
const cliDir = path.join(cinecodeDir, "src", "cli");
function checkNoStrayOptions(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkNoStrayOptions(full);
    } else if (entry.name.endsWith(".ts") && entry.name !== "command-registry.ts" && entry.name !== "program.ts") {
      const content = readFileSync(full, "utf8");
      if (content.includes(".option(")) {
        fail(`File ${path.relative(root, full)} contains .option() call outside command-registry.ts`);
      }
    }
  }
}
checkNoStrayOptions(cliDir);

// 2. Validate commands array count: exactly 30 primary commands
if (!Array.isArray(COMMANDS) || COMMANDS.length !== 30) {
  fail(`Expected exactly 30 primary commands in registry, found ${COMMANDS?.length}`);
}

export function validateRegistry(commandList) {
  const issues = [];
  const primaryNames = new Set();
  const aliasToPrimary = new Map();

  for (const cmd of commandList) {
    if (!cmd.name || typeof cmd.name !== "string") {
      issues.push(`Command missing valid name`);
      continue;
    }
    if (primaryNames.has(cmd.name)) {
      issues.push(`Duplicate primary command name: '${cmd.name}'`);
    }
    primaryNames.add(cmd.name);
  }

  for (const cmd of commandList) {
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (primaryNames.has(alias)) {
          issues.push(`Alias '${alias}' of '${cmd.name}' collides with primary command name`);
        }
        if (aliasToPrimary.has(alias)) {
          issues.push(`Alias '${alias}' of '${cmd.name}' collides with alias of '${aliasToPrimary.get(alias)}'`);
        }
        aliasToPrimary.set(alias, cmd.name);
      }
    }

    if (!["read", "write", "network", "destructive"].includes(cmd.kind)) {
      issues.push(`Command '${cmd.name}' has invalid kind: '${cmd.kind}'`);
    }
    if (!["product", "resource", "maintenance", "informational"].includes(cmd.category)) {
      issues.push(`Command '${cmd.name}' has invalid category: '${cmd.category}'`);
    }
    if (!["artifact", "report", "server", "action", "none"].includes(cmd.outcome)) {
      issues.push(`Command '${cmd.name}' has invalid outcome: '${cmd.outcome}'`);
    }

    if (cmd.requiredProject === true) {
      if (!cmd.projectSelectorRule || !["required", "optional", "none", "selection"].includes(cmd.projectSelectorRule)) {
        issues.push(`Command '${cmd.name}' has requiredProject: true but missing or invalid projectSelectorRule: '${cmd.projectSelectorRule}'`);
      }
    }

    // Verify contract
    if (cmd.contract) {
      if (!Array.isArray(cmd.contract.reads) || cmd.contract.reads.length === 0) {
        issues.push(`Command '${cmd.name}' contract missing non-empty reads`);
      }
      if (!Array.isArray(cmd.contract.writes) || cmd.contract.writes.length === 0) {
        issues.push(`Command '${cmd.name}' contract missing non-empty writes`);
      }
    }

    const seenOptions = new Set();
    if (cmd.options) {
      for (const opt of cmd.options) {
        if (!opt.name || typeof opt.name !== "string") {
          issues.push(`Command '${cmd.name}' has option missing name`);
          continue;
        }
        if (seenOptions.has(opt.name)) {
          issues.push(`Command '${cmd.name}' has duplicate option: '${opt.name}'`);
        }
        seenOptions.add(opt.name);

        if (!opt.type || !["string", "number", "boolean", "path", "enum"].includes(opt.type)) {
          issues.push(`Command '${cmd.name}' option '${opt.name}' has missing or invalid type: '${opt.type}'`);
        }

        if (!("default" in opt)) {
          issues.push(`Command '${cmd.name}' option '${opt.name}' has missing documented default`);
        }

        if (opt.type === "enum") {
          if (!Array.isArray(opt.choices) || opt.choices.length === 0) {
            issues.push(`Command '${cmd.name}' enum option '${opt.name}' missing choices array`);
          }
        }
      }
    }
  }

  for (const [alias, primary] of aliasToPrimary) {
    if (primaryNames.has(alias)) {
      issues.push(`Alias '${alias}' of '${primary}' collides with primary command name`);
    }
  }

  return issues;
}

const registryIssues = validateRegistry(COMMANDS);
for (const issue of registryIssues) {
  fail(issue);
}

// 3. Verify exact 10 Product, 10 Resource, 7 Maintenance, 3 Informational commands
const expectedProduct = ["dev", "preview", "render", "still", "generate", "validate", "clean", "init", "doctor", "inspect"];
const expectedResource = ["media", "plugin", "formats", "presets", "thumbnail", "export-svg", "story", "tts", "compare", "diff"];
const expectedMaintenance = ["audit", "benchmark", "migrate", "check-ignore", "alias", "publish", "upgrade"];
const expectedInformational = ["help", "version", "licence"];

const productCmds = COMMANDS.filter((c) => c.category === "product");
const resourceCmds = COMMANDS.filter((c) => c.category === "resource");
const maintenanceCmds = COMMANDS.filter((c) => c.category === "maintenance");
const infoCmds = COMMANDS.filter((c) => c.category === "informational");

if (productCmds.length !== 10) fail(`Expected 10 product commands, found ${productCmds.length}`);
for (const name of expectedProduct) {
  const found = productCmds.find((c) => c.name === name);
  if (!found) fail(`Product command '${name}' missing`);
  else if (found.hidden) fail(`Product command '${name}' should not be hidden`);
}

if (resourceCmds.length !== 10) fail(`Expected 10 resource commands, found ${resourceCmds.length}`);
for (const name of expectedResource) {
  const found = resourceCmds.find((c) => c.name === name);
  if (!found) fail(`Resource command '${name}' missing`);
  else if (found.hidden) fail(`Resource command '${name}' should not be hidden`);
}

if (maintenanceCmds.length !== 7) fail(`Expected 7 maintenance commands, found ${maintenanceCmds.length}`);
for (const name of expectedMaintenance) {
  const found = maintenanceCmds.find((c) => c.name === name);
  if (!found) fail(`Maintenance command '${name}' missing`);
  else if (!found.hidden) fail(`Maintenance command '${name}' should be hidden`);
}

if (infoCmds.length !== 3) fail(`Expected 3 informational commands, found ${infoCmds.length}`);
for (const name of expectedInformational) {
  const found = infoCmds.find((c) => c.name === name);
  if (!found) fail(`Informational command '${name}' missing`);
  else if (!found.hidden) fail(`Informational command '${name}' should be hidden`);
}

// 4. Verify edit and template do NOT exist
if (COMMANDS.some((c) => c.name === "edit" || c.aliases?.includes("edit"))) {
  fail("Command 'edit' should not exist in registry");
}
if (COMMANDS.some((c) => c.name === "template" || c.aliases?.includes("template"))) {
  fail("Command 'template' should not exist in registry");
}

// 5. Verify 8 forwarding aliases resolve
const expectedAliases = [
  ["check", "validate"],
  ["create", "init"],
  ["health", "doctor"],
  ["sync", "clean"],
  ["render-multi", "render"],
  ["media:list", "media"],
  ["media:download", "media"],
  ["license", "licence"],
];

for (const [alias, targetName] of expectedAliases) {
  const target = findCommand(alias);
  if (!target || target.name !== targetName) {
    fail(`Alias '${alias}' did not resolve to '${targetName}' (got '${target?.name}')`);
  } else if (!target.aliasDeprecations || !target.aliasDeprecations[alias]) {
    fail(`Alias '${alias}' missing deprecation message on target '${targetName}'`);
  }
}

// 6. Verify default help output is compact and only contains product + resource
const defaultHelp = formatHelpText(false);
if (!defaultHelp.includes("Product Commands:") || !defaultHelp.includes("Resource Commands:")) {
  fail("Default help missing Product or Resource commands");
}
if (defaultHelp.includes("Maintenance Commands:") || defaultHelp.includes("Informational Commands:")) {
  fail("Default help should not show Maintenance or Informational commands");
}
const defaultHelpLines = defaultHelp.split("\n").filter((l) => l.trim().length > 0);
if (defaultHelpLines.length > 45) {
  fail(`Default help too long to fit on one screen (${defaultHelpLines.length} lines)`);
}

const allHelp = formatHelpText(true);
if (!allHelp.includes("Maintenance Commands:") || !allHelp.includes("Informational Commands:") || !allHelp.includes("Forwarding Aliases:")) {
  fail("All help (--all) missing Maintenance, Informational or Forwarding Aliases");
}

// 7. Verify serialization contains no Commander objects, functions, or undefined
const serialized = serializeRegistry();
if (!Array.isArray(serialized) || serialized.length !== COMMANDS.length) {
  fail(`serializeRegistry did not return matching count (${serialized?.length} vs ${COMMANDS.length})`);
}

function checkSerializable(val, pathStr = "root") {
  if (val === null || val === undefined) {
    if (val === undefined) fail(`Serialized registry contains undefined at ${pathStr}`);
    return;
  }
  if (typeof val === "function") {
    fail(`Serialized registry contains function at ${pathStr}`);
    return;
  }
  if (typeof val === "object") {
    if (val.constructor && val.constructor.name === "Command") {
      fail(`Serialized registry contains Commander Command instance at ${pathStr}`);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((item, i) => checkSerializable(item, `${pathStr}[${i}]`));
    } else {
      for (const [k, v] of Object.entries(val)) {
        checkSerializable(v, `${pathStr}.${k}`);
      }
    }
  }
}
checkSerializable(serialized);

// 8. Verify gate enforcement
const cleanCmd = COMMANDS.find((c) => c.name === "clean");
if (cleanCmd) {
  const tmpGateDir = path.join(root, ".tmp-registry-gate");
  try {
    mkdirSync(tmpGateDir, { recursive: true });
    writeFileSync(path.join(tmpGateDir, "cinecode.config.json"), "{}", "utf8");
    await executeCommandWithGate(cleanCmd, [], { root: tmpGateDir, yes: false, force: false, interactive: false });
    fail("Expected destructive command 'clean' without consent to throw CC1012");
  } catch (err) {
    if (err?.code !== "CC1012") {
      fail(`Expected 'clean' without consent to throw CC1012, got: ${err?.code || err}`);
    }
  } finally {
    try {
      rmSync(tmpGateDir, { recursive: true, force: true });
    } catch {}
  }
} else {
  fail("Command 'clean' not found in registry for gate test");
}

const upgradeCmd = COMMANDS.find((c) => c.name === "upgrade");
if (upgradeCmd) {
  try {
    await executeCommandWithGate(upgradeCmd, [], { confirm: false });
    fail("Expected network command 'upgrade' without confirm to throw CC7004");
  } catch (err) {
    if (err?.code !== "CC7004") {
      fail(`Expected 'upgrade' without confirm to throw CC7004, got: ${err?.code || err}`);
    }
  }
} else {
  fail("Command 'upgrade' not found in registry for gate test");
}

// 9. Test self-validation logic on invalid inputs (duplicate alias & missing option type)
const testDupAlias = [
  { name: "test1", category: "product", outcome: "none", kind: "read", contract: { reads: ["a"], writes: ["b"] }, aliases: ["tdup"] },
  { name: "test2", category: "product", outcome: "none", kind: "read", contract: { reads: ["a"], writes: ["b"] }, aliases: ["tdup"] },
];
const dupAliasIssues = validateRegistry(testDupAlias);
if (!dupAliasIssues.some((i) => i.includes("collides with alias"))) {
  fail("validateRegistry failed to detect duplicate alias");
}

const testMissingType = [
  { name: "test3", category: "product", outcome: "none", kind: "read", contract: { reads: ["a"], writes: ["b"] }, options: [{ name: "foo", default: "" }] },
];
const missingTypeIssues = validateRegistry(testMissingType);
if (!missingTypeIssues.some((i) => i.includes("missing or invalid type"))) {
  fail("validateRegistry failed to detect missing option type");
}

if (errors > 0) {
  console.error(`check-registry failed with ${errors} error(s)`);
  process.exit(1);
}

console.log(`check-registry ok: 30 canonical commands verified, 8 aliases, contracts, gate enforced`);
