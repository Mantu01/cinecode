export type Language = "typescript" | "javascript";

export interface LanguageChoice {
  readonly value: Language;
  readonly label: string;
}

export interface SelectLanguageOptions {
  readonly input?: NodeJS.ReadStream;
  readonly output?: NodeJS.WriteStream;
  readonly message?: string;
  readonly choices?: readonly LanguageChoice[];
}

const CHOICES: readonly LanguageChoice[] = [
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
];

const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";
const CANCEL = "\u0003";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\u001b[2K";
const CLEAR_DOWN = "\u001b[0J";
const LINE_UP = "\u001b[";

function defaultIndex(choices: readonly LanguageChoice[]): number {
  const found = choices.findIndex((choice) => choice.value === "typescript");
  return found === -1 ? 0 : found;
}

export async function selectLanguage(options: SelectLanguageOptions = {}): Promise<Language> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const choices = options.choices ?? CHOICES;
  const message = options.message ?? "Choose a language";
  const fallbackIndex = defaultIndex(choices);
  const fallback = choices[fallbackIndex]!.value;

  if (!input.isTTY || !output.isTTY) {
    output.write(`${message}: ${choices[fallbackIndex]!.label} (default, pass --ts or --js to choose)\n`);
    return fallback;
  }

  return new Promise<Language>((resolveChoice, rejectChoice) => {
    let selected = fallbackIndex;
    let renderedLines = 0;

    const cursorToTop = (): void => {
      if (renderedLines > 0) {
        output.write(`${LINE_UP}${renderedLines - 1}A`);
      }
    };

    const stop = (): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
    };

    const draw = (): void => {
      cursorToTop();
      const lines = [
        `? ${message} (arrow keys, enter to confirm)`,
        ...choices.map((choice, index) => `${index === selected ? ">" : " "} ${choice.label}`),
      ];
      for (let i = 0; i < lines.length; i += 1) {
        output.write(`\r${CLEAR_LINE}${lines[i]}`);
        if (i < lines.length - 1) output.write("\n");
      }
      renderedLines = lines.length;
    };

    const confirm = (): void => {
      const choice = choices[selected]!;
      stop();
      cursorToTop();
      output.write(`\r${CLEAR_LINE}Language: ${choice.label}\n${CLEAR_DOWN}`);
      output.write(SHOW_CURSOR);
      resolveChoice(choice.value);
    };

    const cancel = (): void => {
      stop();
      output.write(`${SHOW_CURSOR}\n`);
      rejectChoice(new Error("Language selection cancelled"));
    };

    const onData = (chunk: Buffer | string): void => {
      const sequence = String(chunk);
      if (sequence.includes(CANCEL)) {
        cancel();
        return;
      }
      if (sequence.includes(ARROW_UP) || sequence === "k") {
        selected = (selected + choices.length - 1) % choices.length;
        draw();
        return;
      }
      if (sequence.includes(ARROW_DOWN) || sequence === "j" || sequence === "\t") {
        selected = (selected + 1) % choices.length;
        draw();
        return;
      }
      const digit = sequence.match(/^[1-9]$/);
      if (digit) {
        const index = Number(digit[0]) - 1;
        if (index < choices.length) {
          selected = index;
          confirm();
        }
        return;
      }
      if (sequence.includes("\r") || sequence.includes("\n")) {
        confirm();
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    output.write(HIDE_CURSOR);
    draw();
  });
}