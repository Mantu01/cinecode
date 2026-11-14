import { Command } from "commander";
import { loadAliases, setAlias, removeAlias } from "./profiles.js";

export function createAliasCommand(): Command {
  const cmd = new Command("alias")
    .description("Manage shorthand CLI command aliases");

  cmd
    .command("list")
    .description("List all configured shorthand aliases")
    .action(() => {
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
    });

  cmd
    .command("set <name> <expansion...>")
    .description("Set a new shorthand command alias")
    .action((name: string, expansionParts: string[]) => {
      const expansion = expansionParts.join(" ");
      setAlias(name, expansion);
      console.log(`✔ Alias '${name}' set to: '${expansion}'`);
    });

  cmd
    .command("remove <name>")
    .description("Remove an existing alias")
    .action((name: string) => {
      const removed = removeAlias(name);
      if (removed) {
        console.log(`✔ Alias '${name}' removed.`);
      } else {
        console.log(`Alias '${name}' not found.`);
      }
    });

  return cmd;
}
