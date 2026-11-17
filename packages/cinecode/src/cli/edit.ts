import { Command } from "commander";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadComposition } from "./composition-loader.js";
import { runReport } from "./run-report.js";

export interface EditOptions {
  json?: boolean;
  editor?: string;
}

function editorCommand(): { command: string; args: readonly string[] } {
  const configured = process.env.VISUAL ?? process.env.EDITOR;
  if (configured) {
    const [command, ...args] = configured.split(" ");
    return { command: command ?? "vi", args };
  }
  if (process.platform === "win32") return { command: "notepad", args: [] };
  if (process.platform === "darwin") return { command: "open", args: ["-t"] };
  return { command: "xdg-open", args: [] };
}

export async function openFileInEditor(file: string, editor?: string): Promise<void> {
  const target = resolve(file);
  const spec = editor ? { command: editor, args: [] as string[] } : editorCommand();
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(spec.command, [...spec.args, target], { stdio: "inherit", windowsHide: false });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`Editor exited with code ${code}`))));
  });
}

export async function editCommand(file: string, options: EditOptions): Promise<void> {
  if (options.json) {
    const compositions = await loadComposition(file);
    runReport.result({ composition: compositions.length === 1 ? compositions[0] : compositions });
    return;
  }
  await openFileInEditor(file, options.editor);
}

export function createEditCommand(): Command {
  return new Command("edit")
    .description("Open a composition in your editor, or print it as JSON")
    .argument("<composition>", "Composition file")
    .option("--editor <command>", "Editor command to launch")
    .action(async (file: string, options: EditOptions) => {
      await editCommand(file, options);
    });
}
