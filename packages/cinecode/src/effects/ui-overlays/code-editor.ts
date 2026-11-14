import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { renderOverlayCanvas } from "./common.js";

export type CodeLanguage = "javascript" | "typescript" | "python" | "html" | "css" | "json" | "markdown" | string;
export type CodeEditorTheme = "vs-dark" | "vs-light" | "monokai" | "github-dark" | "github-light";

export type TokenType =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "function"
  | "type"
  | "tag"
  | "attribute"
  | "property"
  | "heading"
  | "plain";

export interface CodeToken {
  readonly text: string;
  readonly type: TokenType;
}

export interface CodeEditorOptions {
  readonly theme?: CodeEditorTheme;
  readonly language?: CodeLanguage;
  readonly code?: string;
  readonly showLineNumbers?: boolean;
  readonly highlightLines?: readonly number[];
  readonly fileName?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly showSidebar?: boolean;
  readonly sidebarFiles?: readonly string[];
  readonly showStatusBar?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly lineHeight?: number;
}

const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "new", "import", "from", "export", "default", "async", "await", "try", "catch", "throw", "typeof", "instanceof", "null", "undefined", "true", "false", "this", "extends", "switch", "case", "break", "continue", "delete", "in", "of"],
  typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "interface", "type", "enum", "implements", "extends", "new", "import", "from", "export", "default", "async", "await", "try", "catch", "throw", "typeof", "keyof", "as", "public", "private", "protected", "readonly", "namespace", "declare", "null", "undefined", "true", "false", "this", "switch", "case", "break", "continue"],
  python: ["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "try", "except", "finally", "raise", "lambda", "yield", "async", "await", "pass", "break", "continue", "None", "True", "False", "and", "or", "not", "in", "is", "global", "nonlocal"],
  json: ["true", "false", "null"],
};

const THEMES: Readonly<Record<CodeEditorTheme, { bg: string; tab: string; gutter: string; text: string; tokens: Record<TokenType, string>; accent: string; status: string; selection: string }>> = {
  "vs-dark": {
    bg: "#1e1e1e", tab: "#252526", gutter: "#858585", text: "#d4d4d4", accent: "#007acc", status: "#007acc", selection: "#264f78",
    tokens: {
      keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", comment: "#6a9955", operator: "#d4d4d4",
      function: "#dcdcaa", type: "#4ec9b0", tag: "#569cd6", attribute: "#9cdcfe", property: "#9cdcfe", heading: "#569cd6", plain: "#d4d4d4",
    },
  },
  "vs-light": {
    bg: "#ffffff", tab: "#ececec", gutter: "#237893", text: "#1e1e1e", accent: "#007acc", status: "#007acc", selection: "#add6ff",
    tokens: {
      keyword: "#0000ff", string: "#a31515", number: "#098658", comment: "#008000", operator: "#1e1e1e",
      function: "#795e26", type: "#267f99", tag: "#800000", attribute: "#e50000", property: "#0451a5", heading: "#800000", plain: "#1e1e1e",
    },
  },
  monokai: {
    bg: "#272822", tab: "#1e1f1c", gutter: "#75715e", text: "#f8f8f2", accent: "#fd971f", status: "#1e1f1c", selection: "#49483e",
    tokens: {
      keyword: "#f92672", string: "#e6db74", number: "#ae81ff", comment: "#75715e", operator: "#f92672",
      function: "#a6e22e", type: "#66d9ef", tag: "#f92672", attribute: "#a6e22e", property: "#66d9ef", heading: "#a6e22e", plain: "#f8f8f2",
    },
  },
  "github-dark": {
    bg: "#0d1117", tab: "#161b22", gutter: "#6e7681", text: "#c9d1d9", accent: "#1f6feb", status: "#161b22", selection: "#264f78",
    tokens: {
      keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", operator: "#ff7b72",
      function: "#d2a8ff", type: "#ffa657", tag: "#7ee787", attribute: "#79c0ff", property: "#79c0ff", heading: "#1f6feb", plain: "#c9d1d9",
    },
  },
  "github-light": {
    bg: "#ffffff", tab: "#f6f8fa", gutter: "#8c959f", text: "#24292f", accent: "#0969da", status: "#f6f8fa", selection: "#b6d7ff",
    tokens: {
      keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#6e7781", operator: "#cf222e",
      function: "#8250df", type: "#953800", tag: "#116329", attribute: "#0550ae", property: "#0550ae", heading: "#0550ae", plain: "#24292f",
    },
  },
};

export function tokenizeCode(code: string, language: CodeLanguage = "typescript"): readonly (readonly CodeToken[])[] {
  if (language === "markdown") {
    return code.split("\n").map((line) => {
      if (/^#{1,6}\s/.test(line)) return [{ text: line, type: "heading" as const }];
      if (/^\s*```/.test(line)) return [{ text: line, type: "string" as const }];
      return [{ text: line, type: "plain" as const }];
    });
  }
  if (language === "html") return tokenizeHtml(code);
  if (language === "css") return tokenizeCss(code);
  return tokenizeGeneric(code, KEYWORDS[language] ?? KEYWORDS.typescript ?? [], language);
}

function tokenizeGeneric(code: string, keywords: readonly string[], language: CodeLanguage): readonly (readonly CodeToken[])[] {
  const lines: CodeToken[][] = [];
  const commentLine = language === "python" ? "#" : "//";
  let inBlockComment = false;
  for (const rawLine of code.split("\n")) {
    const line: CodeToken[] = [];
    let index = 0;
    while (index < rawLine.length) {
      if (inBlockComment) {
        const end = rawLine.indexOf("*/", index);
        if (end === -1) {
          line.push({ text: rawLine.slice(index), type: "comment" });
          index = rawLine.length;
        } else {
          line.push({ text: rawLine.slice(index, end + 2), type: "comment" });
          index = end + 2;
          inBlockComment = false;
        }
        continue;
      }
      const rest = rawLine.slice(index);
      const blockStart = rest.indexOf("/*");
      if (blockStart === 0) {
        const end = rawLine.indexOf("*/", 2);
        if (end === -1) {
          line.push({ text: rest, type: "comment" });
          index = rawLine.length;
          inBlockComment = true;
        } else {
          line.push({ text: rawLine.slice(index, end + 2), type: "comment" });
          index = end + 2;
        }
        continue;
      }
      if (rest.startsWith(commentLine) || (language === "json" && rest.startsWith("//"))) {
        line.push({ text: rest, type: "comment" });
        index = rawLine.length;
        continue;
      }
      const character = rawLine[index]!;
      if (character === "\"" || character === "'" || character === "`") {
        let end = index + 1;
        while (end < rawLine.length && rawLine[end] !== character) {
          if (rawLine[end] === "\\") end += 1;
          end += 1;
        }
        line.push({ text: rawLine.slice(index, Math.min(rawLine.length, end + 1)), type: "string" });
        index = Math.min(rawLine.length, end + 1);
        continue;
      }
      const numberMatch = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
      if (numberMatch && /[\d-]/.test(character)) {
        line.push({ text: numberMatch[0], type: "number" });
        index += numberMatch[0].length;
        continue;
      }
      const identifierMatch = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (identifierMatch) {
        const word = identifierMatch[0];
        let type: TokenType = "plain";
        if (keywords.includes(word)) type = "keyword";
        else if (/^\s*\(/.test(rest.slice(word.length))) type = "function";
        else if (/^[A-Z]/.test(word)) type = "type";
        line.push({ text: word, type });
        index += word.length;
        continue;
      }
      const operatorMatch = /^[+\-*/%=<>!&|^~?:]+/.exec(rest);
      if (operatorMatch) {
        line.push({ text: operatorMatch[0], type: "operator" });
        index += operatorMatch[0].length;
        continue;
      }
      line.push({ text: character, type: "plain" });
      index += 1;
    }
    lines.push(line);
  }
  return lines;
}

function tokenizeHtml(code: string): readonly (readonly CodeToken[])[] {
  const lines: CodeToken[][] = [];
  for (const rawLine of code.split("\n")) {
    const line: CodeToken[] = [];
    const pattern = /(<!--.*?-->)|(<\/?)([\w-]+)|([\w-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rawLine)) !== null) {
      if (match.index > lastIndex) line.push({ text: rawLine.slice(lastIndex, match.index), type: "plain" });
      if (match[1]) line.push({ text: match[1], type: "comment" });
      else if (match[2]) {
        line.push({ text: match[2] + match[3], type: "tag" });
      } else if (match[4]) {
        line.push({ text: match[4], type: "attribute" });
        line.push({ text: match[5]!, type: "operator" });
        if (match[6]) line.push({ text: match[6], type: "string" });
      } else if (match[7]) line.push({ text: match[7], type: "tag" });
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < rawLine.length) line.push({ text: rawLine.slice(lastIndex), type: "plain" });
    lines.push(line);
  }
  return lines;
}

function tokenizeCss(code: string): readonly (readonly CodeToken[])[] {
  const lines: CodeToken[][] = [];
  for (const rawLine of code.split("\n")) {
    const line: CodeToken[] = [];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("/*")) {
      line.push({ text: rawLine, type: "comment" });
      lines.push(line);
      continue;
    }
    const propertyMatch = /^(\s*)([\w-]+)(\s*:)(.*)$/.exec(rawLine);
    if (propertyMatch) {
      if (propertyMatch[1]) line.push({ text: propertyMatch[1], type: "plain" });
      line.push({ text: propertyMatch[2]!, type: "property" });
      line.push({ text: propertyMatch[3]!, type: "operator" });
      const value = propertyMatch[4]!;
      const valuePattern = /("[^"]*"|'[^']*')|(#[\da-fA-F]{3,8})|(\b\d+(\.\d+)?(px|rem|em|%|vh|vw|s|ms|deg)?\b)/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = valuePattern.exec(value)) !== null) {
        if (match.index > lastIndex) line.push({ text: value.slice(lastIndex, match.index), type: "plain" });
        line.push({ text: match[0], type: match[1] ? "string" : "number" });
        lastIndex = valuePattern.lastIndex;
      }
      if (lastIndex < value.length) line.push({ text: value.slice(lastIndex), type: "plain" });
    } else if (trimmed.startsWith(".") || trimmed.startsWith("#") || trimmed.endsWith("{")) {
      line.push({ text: rawLine, type: "tag" });
    } else {
      line.push({ text: rawLine, type: "plain" });
    }
    lines.push(line);
  }
  return lines;
}

export function drawCodeEditor(ctx: SKRSContext2D, options: CodeEditorOptions = {}): void {
  const width = options.width ?? 960;
  const height = options.height ?? 600;
  const theme = THEMES[options.theme ?? "vs-dark"];
  const fontSize = options.fontSize ?? 14;
  const fontFamily = options.fontFamily ?? "monospace";
  const lineHeight = options.lineHeight ?? Math.round(fontSize * 1.6);
  const tabHeight = 36;
  const statusHeight = options.showStatusBar === false ? 0 : 24;
  const sidebarWidth = options.showSidebar ? 180 : 0;
  const padding = options.padding ?? 16;
  const showLineNumbers = options.showLineNumbers !== false;
  const code = options.code ?? "";
  const fileLabel = options.fileName ?? "untitled.ts";
  const lines = tokenizeCode(code, options.language ?? "typescript");
  const highlight = new Set(options.highlightLines ?? []);

  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = theme.tab;
  ctx.fillRect(0, 0, width, tabHeight);

  const tabWidth = Math.min(220, width * 0.4);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, tabWidth, tabHeight);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, tabWidth, 2);
  ctx.fillStyle = theme.text;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.fillText(fileLabel, 16, tabHeight / 2 + 1);

  if (options.showSidebar) {
    ctx.fillStyle = theme.tab;
    ctx.fillRect(0, tabHeight, sidebarWidth, height - tabHeight - statusHeight);
    ctx.fillStyle = theme.text;
    ctx.font = `12px ${fontFamily}`;
    const files = options.sidebarFiles ?? [fileLabel, "index.ts", "utils.ts", "package.json", "README.md"];
    files.forEach((file, index) => {
      ctx.globalAlpha = index === 0 ? 1 : 0.7;
      ctx.fillText(file, 14, tabHeight + 28 + index * 24);
    });
    ctx.globalAlpha = 1;
  }

  const codeX = sidebarWidth + padding;
  const gutterWidth = showLineNumbers ? Math.max(36, String(lines.length).length * 10 + 20) : 0;
  const startY = tabHeight + padding * 0.5;
  const maxLines = Math.floor((height - statusHeight - startY - padding) / lineHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(sidebarWidth, tabHeight, width - sidebarWidth, height - tabHeight - statusHeight);
  ctx.clip();

  lines.slice(0, maxLines).forEach((tokens, index) => {
    const lineNumber = index + 1;
    const y = startY + index * lineHeight;
    if (highlight.has(lineNumber)) {
      ctx.fillStyle = theme.selection;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sidebarWidth, y - 2, width - sidebarWidth, lineHeight);
      ctx.globalAlpha = 1;
    }
    if (showLineNumbers) {
      ctx.fillStyle = theme.gutter;
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textAlign = "right";
      ctx.fillText(String(lineNumber), sidebarWidth + gutterWidth - 10, y + lineHeight / 2);
      ctx.textAlign = "left";
    }
    let x = codeX + gutterWidth;
    for (const token of tokens) {
      const color = theme.tokens[token.type] ?? theme.text;
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.fillText(token.text, x, y + lineHeight / 2);
      x += ctx.measureText(token.text).width;
      if (x > width - padding) break;
    }
  });
  ctx.restore();

  if (statusHeight > 0) {
    ctx.fillStyle = theme.status;
    ctx.fillRect(0, height - statusHeight, width, statusHeight);
    ctx.fillStyle = options.theme === "vs-light" || options.theme === "github-light" ? "#ffffff" : "#ffffff";
    ctx.font = `11px ${fontFamily}`;
    ctx.fillText(`${options.language ?? "typescript"}  Ln 1, Col 1  UTF-8`, 12, height - statusHeight / 2);
    ctx.textAlign = "right";
    ctx.fillText("UTF-8  LF", width - 12, height - statusHeight / 2);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

export function renderCodeEditor(options: CodeEditorOptions = {}): Canvas {
  const width = options.width ?? 960;
  const height = options.height ?? 600;
  return renderOverlayCanvas(width, height, (ctx) => {
    drawCodeEditor(ctx, { ...options, width, height });
  });
}
