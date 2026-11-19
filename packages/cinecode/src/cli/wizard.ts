import { Command } from "commander";
import { createCreateCommand } from "./create.js";

export interface WizardOptions {
  name?: string;
  template?: string;
  yes?: boolean;
}

export function createInitCommand(): Command {
  const cmd = createCreateCommand();
  cmd.name("init")
    .description("Scaffold a new Cinecode project");
  return cmd;
}

export async function runInitWizard(options: WizardOptions = {}): Promise<void> {
  const cmd = createInitCommand();
  const args = [options.name ?? "my-cinecode-video"];
  await cmd.parseAsync(args, { from: "user" });
}
