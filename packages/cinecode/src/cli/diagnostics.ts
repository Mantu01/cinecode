import fs from "node:fs";
import pc from "picocolors";

export interface DiagnosticOptions {
  code: string;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  length?: number;
  fixHint?: string;
  severity?: "error" | "warning" | "info";
  noColor?: boolean;
}

export function formatDiagnostic(options: DiagnosticOptions): string {
  const isNoColor = options.noColor || Boolean(process.env.NO_COLOR) || process.argv.includes("--no-color");
  const severity = options.severity || "error";
  const badgeText = severity === "error" ? `[ERROR ${options.code}]` : severity === "warning" ? `[WARN ${options.code}]` : `[INFO ${options.code}]`;

  const badge = isNoColor
    ? badgeText
    : severity === "error"
    ? pc.bold(pc.bgRed(pc.white(` ${badgeText} `)))
    : severity === "warning"
    ? pc.bold(pc.bgYellow(pc.black(` ${badgeText} `)))
    : pc.bold(pc.bgCyan(pc.black(` ${badgeText} `)));

  const title = isNoColor ? options.message : pc.bold(options.message);
  const outLines: string[] = [`\n${badge} ${title}`];

  if (options.filePath) {
    const loc = options.line !== undefined ? `:${options.line}${options.column !== undefined ? `:${options.column}` : ""}` : "";
    const pathStr = `  --> ${options.filePath}${loc}`;
    outLines.push(isNoColor ? pathStr : pc.cyan(pathStr));

    if (options.line !== undefined && fs.existsSync(options.filePath)) {
      try {
        const fileContent = fs.readFileSync(options.filePath, "utf8");
        const lines = fileContent.split(/\r?\n/);
        const targetLineIdx = options.line - 1;

        const startIdx = Math.max(0, targetLineIdx - 2);
        const endIdx = Math.min(lines.length - 1, targetLineIdx + 2);

        outLines.push(isNoColor ? "   |" : pc.dim("   |"));

        for (let i = startIdx; i <= endIdx; i++) {
          const lineNum = String(i + 1).padStart(3, " ");
          const lineContent = lines[i] || "";
          const isTarget = i === targetLineIdx;

          if (isTarget) {
            const prefix = isNoColor ? ` > ${lineNum} | ` : pc.red(` > ${pc.bold(lineNum)} | `);
            outLines.push(`${prefix}${lineContent}`);

            if (options.column !== undefined) {
              const col = Math.max(0, options.column - 1);
              const markerLen = Math.max(1, options.length || 1);
              const carets = "^".repeat(markerLen);
              const indent = " ".repeat(col);
              const caretLine = isNoColor ? `   |   ${indent}${carets}` : pc.red(pc.bold(`   |   ${indent}${carets}`));
              outLines.push(caretLine);
            }
          } else {
            const prefix = isNoColor ? `   ${lineNum} | ` : pc.dim(`   ${lineNum} | `);
            outLines.push(`${prefix}${isNoColor ? lineContent : pc.dim(lineContent)}`);
          }
        }
        outLines.push(isNoColor ? "   |" : pc.dim("   |"));
      } catch {
        // Note: ignore snippet read error during diagnostic formatting
      }
    }
  }

  if (options.fixHint) {
    const hintBox = [
      isNoColor ? `Suggested Fix:` : pc.green(pc.bold("Suggested Fix:")),
      `  ${options.fixHint}`,
    ];
    outLines.push(`\n${hintBox.join("\n")}`);
  }

  outLines.push("");
  return outLines.join("\n");
}
