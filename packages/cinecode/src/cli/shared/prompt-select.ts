import readline from "node:readline";
import { runReport } from "../output/run-report.js";

export interface SelectItem<T> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
}

export interface MultiSelectOptions {
  /** Start with every item checked. */
  readonly preselectAll?: boolean;
}

/**
 * A dependency-free interactive checkbox prompt (in the spirit of
 * `@inquirer/checkbox`). Falls back to selecting everything when stdin is not
 * a TTY so CI/scripted runs still work.
 */
export async function multiSelect<T>(
  message: string,
  items: readonly SelectItem<T>[],
  options: MultiSelectOptions = {},
): Promise<T[]> {
  if (items.length === 0) return [];
  if (!process.stdin.isTTY || runReport.isMachine()) {
    return items.map((item) => item.value);
  }

  const checked = (options.preselectAll ?? false)
    ? items.map(() => true)
    : items.map(() => false);
  let cursor = 0;
  let renderedLines = 0;

  const output = process.stderr;
  readline.emitKeypressEvents(process.stdin);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();

  const render = (first: boolean): void => {
    if (!first) {
      output.write(`\x1b[${renderedLines}A`);
      output.write("\x1b[J");
    }
    const lines: string[] = [];
    lines.push(`${message} (space select, a all, enter confirm)`);
    items.forEach((item, index) => {
      const pointer = index === cursor ? "❯" : " ";
      const box = checked[index] ? "◉" : "◯";
      const suffix = item.detail ? ` ${item.detail}` : "";
      lines.push(`${pointer} ${box} ${item.label}${suffix}`);
    });
    renderedLines = lines.length;
    output.write(lines.join("\n") + "\n");
  };

  render(true);

  return new Promise<T[]>((resolvePromise, rejectPromise) => {
    const cleanup = (): void => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("keypress", onKeypress);
    };

    const finish = (): void => {
      cleanup();
      output.write("\n");
      resolvePromise(items.filter((_, index) => checked[index]).map((item) => item.value));
    };

    const onKeypress = (_str: string | undefined, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        output.write("\n");
        rejectPromise(new Error("Cancelled"));
        return;
      }
      switch (key.name) {
        case "up":
        case "k":
          cursor = (cursor - 1 + items.length) % items.length;
          render(false);
          break;
        case "down":
        case "j":
          cursor = (cursor + 1) % items.length;
          render(false);
          break;
        case "space":
          checked[cursor] = !checked[cursor];
          render(false);
          break;
        case "a":
          {
            const target = !checked.every(Boolean);
            for (let i = 0; i < checked.length; i++) checked[i] = target;
            render(false);
          }
          break;
        case "return":
        case "enter":
          finish();
          break;
        default:
          break;
      }
    };

    stdin.on("keypress", onKeypress);
  });
}
