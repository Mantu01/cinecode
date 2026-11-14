import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { TEMPLATES, renderTemplate, type CompositionTemplate } from "../templates/index.js";
import { openFileInEditor } from "./edit.js";

export function findTemplate(name: string): CompositionTemplate | undefined {
  return TEMPLATES.find((template) => template.name === name);
}

export async function scaffoldTemplate(name: string, target?: string, open = false): Promise<string> {
  const template = findTemplate(name);
  if (!template) throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((entry) => entry.name).join(", ")}`);
  const outputPath = resolve(target ?? `${name}.cinecode.ts`);
  const compositionName = basename(outputPath).replace(/\.[^.]+$/, "");
  await writeFile(outputPath, renderTemplate(template, compositionName), "utf-8");
  if (open) await openFileInEditor(outputPath);
  return outputPath;
}

export function createTemplateCommand(): Command {
  return new Command("template")
    .description("List or scaffold starter compositions")
    .argument("[name]", "Template name")
    .argument("[target]", "Output file path")
    .option("--open", "Open the generated file in your editor")
    .action(async (name: string | undefined, target: string | undefined, options: { open?: boolean }) => {
      if (!name) {
        console.log("Available templates\n");
        for (const template of TEMPLATES) {
          console.log(`  ${template.name.padEnd(16)} ${template.description}`);
        }
        console.log("\nScaffold one with: cinecode template <name> [file]");
        return;
      }
      const outputPath = await scaffoldTemplate(name, target, options.open);
      console.log(`Created ${outputPath}`);
    });
}
