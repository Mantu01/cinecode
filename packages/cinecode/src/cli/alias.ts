import { Command } from "commander";
import { loadAliases, setAlias, removeAlias, migrateGlobalAliases } from "./profiles.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";

export async function aliasCommand(action = "list", name?: string, ...rest: unknown[]): Promise<void> {
  if (action === "list") {
    const aliases = loadAliases();
    const keys = Object.keys(aliases);
    if (keys.length === 0) {
      console.log("No command aliases configured. Use 'cinecode alias set <name> <expansion>' to add one.");
      return;
    }

    console.log("ALIAS".padEnd(16) + "EXPANSION");
    console.log("-".repeat(60));
    for (const k of keys) {
      console.log(k.padEnd(16) + aliases[k]);
    }
    return;
  }

  if (action === "set") {
    const expansionParts = rest.filter((p): p is string => typeof p === "string");
    const expansion = expansionParts.join(" ");
    if (name) {
      setAlias(name, expansion);
      console.log(`✔ Alias '${name}' set to: '${expansion}'`);
    }
    return;
  }

  if (action === "remove") {
    if (name) {
      const removed = removeAlias(name);
      if (removed) {
        console.log(`✔ Alias '${name}' removed.`);
      } else {
        console.log(`Alias '${name}' not found.`);
      }
    }
    return;
  }

  if (action === "migrate") {
    const res = migrateGlobalAliases();
    if (res.migrated.length > 0) {
      console.log(`✔ Migrated ${res.migrated.length} global alias(es) to project cinecode.json: ${res.migrated.join(", ")}`);
    } else {
      console.log("No global aliases to migrate.");
    }
    return;
  }
}

export function createAliasCommand(): Command {
  return buildCommanderCommand(findCommand("alias")!);
}
