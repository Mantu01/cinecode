import { createError, ErrorCode } from "../../errors/index.js";
import type { ConfigObject } from "./types.js";

export interface Token {
  type:
    | "braceOpen"
    | "braceClose"
    | "bracketOpen"
    | "bracketClose"
    | "colon"
    | "comma"
    | "parenOpen"
    | "parenClose"
    | "semicolon"
    | "dot"
    | "assign"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "identifier"
    | "comment";
  value: unknown; // Note: arbitrary JSON AST node value
  raw: string;
  line: number;
  col: number;
}

export function tokenize(source: string, absPath: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let col = 1;

  function advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (source[index + i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    index += count;
  }

  while (index < source.length) {
    const ch = source[index]!;

    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }

    if (ch === "/" && source[index + 1] === "/") {
      const startLine = line;
      const startCol = col;
      let raw = "";
      while (index < source.length && source[index] !== "\n") {
        raw += source[index];
        advance(1);
      }
      tokens.push({ type: "comment", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    if (ch === "/" && source[index + 1] === "*") {
      const startLine = line;
      const startCol = col;
      let raw = "/*";
      advance(2);
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        raw += source[index];
        advance(1);
      }
      if (index < source.length) {
        raw += "*/";
        advance(2);
      }
      tokens.push({ type: "comment", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    if (ch === "{") { tokens.push({ type: "braceOpen", value: "{", raw: "{", line, col }); advance(1); continue; }
    if (ch === "}") { tokens.push({ type: "braceClose", value: "}", raw: "}", line, col }); advance(1); continue; }
    if (ch === "[") { tokens.push({ type: "bracketOpen", value: "[", raw: "[", line, col }); advance(1); continue; }
    if (ch === "]") { tokens.push({ type: "bracketClose", value: "]", raw: "]", line, col }); advance(1); continue; }
    if (ch === ":") { tokens.push({ type: "colon", value: ":", raw: ":", line, col }); advance(1); continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: ",", raw: ",", line, col }); advance(1); continue; }
    if (ch === "(") { tokens.push({ type: "parenOpen", value: "(", raw: "(", line, col }); advance(1); continue; }
    if (ch === ")") { tokens.push({ type: "parenClose", value: ")", raw: ")", line, col }); advance(1); continue; }
    if (ch === ";") { tokens.push({ type: "semicolon", value: ";", raw: ";", line, col }); advance(1); continue; }
    if (ch === ".") { tokens.push({ type: "dot", value: ".", raw: ".", line, col }); advance(1); continue; }
    if (ch === "=") { tokens.push({ type: "assign", value: "=", raw: "=", line, col }); advance(1); continue; }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      const startCol = col;
      advance(1);
      let value = "";
      let raw = quote;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          raw += source[index];
          advance(1);
          if (index < source.length) {
            raw += source[index];
            const esc = source[index]!;
            if (esc === "n") value += "\n";
            else if (esc === "t") value += "\t";
            else if (esc === "r") value += "\r";
            else value += esc;
            advance(1);
          }
        } else {
          raw += source[index];
          value += source[index];
          advance(1);
        }
      }
      if (index >= source.length) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: "Unterminated string literal" },
          { location: { file: absPath, line: startLine, column: startCol } },
        );
      }
      raw += quote;
      advance(1);
      tokens.push({ type: "string", value, raw, line: startLine, col: startCol });
      continue;
    }

    if (/[0-9\-]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let raw = "";
      if (ch === "-") {
        raw += "-";
        advance(1);
      }
      while (index < source.length && /[0-9.]/.test(source[index]!)) {
        raw += source[index];
        advance(1);
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Invalid number literal: ${raw}` },
          { location: { file: absPath, line: startLine, column: startCol } },
        );
      }
      tokens.push({ type: "number", value: num, raw, line: startLine, col: startCol });
      continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let raw = "";
      while (index < source.length && /[a-zA-Z0-9_$]/.test(source[index]!)) {
        raw += source[index];
        advance(1);
      }
      if (raw === "true") tokens.push({ type: "boolean", value: true, raw, line: startLine, col: startCol });
      else if (raw === "false") tokens.push({ type: "boolean", value: false, raw, line: startLine, col: startCol });
      else if (raw === "null") tokens.push({ type: "null", value: null, raw, line: startLine, col: startCol });
      else tokens.push({ type: "identifier", value: raw, raw, line: startLine, col: startCol });
      continue;
    }

    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Unexpected character '${ch}'` },
      { location: { file: absPath, line, column: col } },
    );
  }

  return tokens;
}

export function parseCodeConfigSafe(source: string, absPath: string): ConfigObject {
  const tokens = tokenize(source, absPath);
  let cursor = 0;

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") cursor++;

  while (cursor < tokens.length && tokens[cursor]!.type === "identifier" && tokens[cursor]!.value === "import") {
    cursor++;
    let specifier: string | null = null;
    while (cursor < tokens.length && tokens[cursor]!.type !== "semicolon") {
      if (tokens[cursor]!.type === "identifier" && tokens[cursor]!.value === "from") {
        cursor++;
        if (cursor < tokens.length && tokens[cursor]!.type === "string") {
          specifier = String(tokens[cursor]!.value);
          cursor++;
        }
        break;
      }
      cursor++;
    }
    if (cursor < tokens.length && tokens[cursor]!.type === "semicolon") cursor++;
    if (specifier !== "cinecode") {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: `Custom import from "${specifier}" cannot be safely migrated. Please update your configuration manually.`,
        },
        { location: { file: absPath } },
      );
    }
  }

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") cursor++;

  if (cursor < tokens.length && tokens[cursor]!.type === "identifier") {
    const val = String(tokens[cursor]!.value);
    if (["const", "let", "var", "function", "class", "type", "interface"].includes(val)) {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: `Custom declaration "${val}" cannot be safely migrated. Please update your configuration manually.`,
        },
        { location: { file: absPath } },
      );
    }
  }

  let isDefineConfig = false;
  if (
    tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "export" &&
    tokens[cursor + 1]?.type === "identifier" && tokens[cursor + 1]!.value === "default"
  ) {
    cursor += 2;
  } else if (
    tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "module" &&
    tokens[cursor + 1]?.type === "dot" &&
    tokens[cursor + 2]?.type === "identifier" && tokens[cursor + 2]!.value === "exports" &&
    tokens[cursor + 3]?.type === "assign"
  ) {
    cursor += 4;
  }

  if (tokens[cursor]?.type === "identifier" && tokens[cursor]!.value === "defineConfig") {
    isDefineConfig = true;
    cursor++;
    if (tokens[cursor]?.type !== "parenOpen") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '(' after defineConfig" }, { location: { file: absPath } });
    }
    cursor++;
  } else if (tokens[cursor]?.type === "parenOpen") {
    cursor++;
  }

  if (tokens[cursor]?.type !== "braceOpen") {
    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Expected '{' starting config object, found ${tokens[cursor]?.value ?? "EOF"}` },
      { location: { file: absPath } },
    );
  }

  let braceDepth = 0;
  for (let i = cursor; i < tokens.length; i++) {
    if (tokens[i]!.type === "braceOpen") braceDepth++;
    if (tokens[i]!.type === "braceClose") {
      braceDepth--;
      if (braceDepth === 0) break;
    }
    if (tokens[i]!.type === "comment") {
      throw createError(
        ErrorCode.CC1006,
        {
          path: absPath,
          reason: "Configuration contains comments that cannot be preserved during automatic migration. Please update manually.",
        },
        { location: { file: absPath } },
      );
    }
  }

  function parseValue(): unknown { // Note: arbitrary JSON AST node value
    const tok = tokens[cursor];
    if (!tok) {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Unexpected end of input" }, { location: { file: absPath } });
    }
    if (tok.type === "string" || tok.type === "number" || tok.type === "boolean" || tok.type === "null") {
      cursor++;
      return tok.value;
    }
    if (tok.type === "braceOpen") return parseObject();
    if (tok.type === "bracketOpen") return parseArray();
    throw createError(
      ErrorCode.CC1006,
      {
        path: absPath,
        reason: `Unexpected token "${tok.value}" in config value. Computed values or variables cannot be safely migrated.`,
      },
      { location: { file: absPath, line: tok.line, column: tok.col } },
    );
  }

  function parseObject(): ConfigObject {
    if (tokens[cursor]?.type !== "braceOpen") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '{'" }, { location: { file: absPath } });
    }
    cursor++;
    const obj: ConfigObject = {};

    while (cursor < tokens.length && tokens[cursor]!.type !== "braceClose") {
      if (tokens[cursor]!.type === "comma") {
        cursor++;
        continue;
      }
      const keyTok = tokens[cursor]!;
      if (keyTok.type !== "identifier" && keyTok.type !== "string") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected identifier or string key, found "${keyTok.value}"` },
          { location: { file: absPath, line: keyTok.line, column: keyTok.col } },
        );
      }
      const key = String(keyTok.value);
      cursor++;

      if (tokens[cursor]?.type !== "colon") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ':' after key "${key}", found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
      cursor++;

      obj[key] = parseValue();

      if (tokens[cursor]?.type === "comma") {
        cursor++;
      } else if (tokens[cursor]?.type !== "braceClose") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ',' or '}' after value for "${key}", found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
    }

    if (tokens[cursor]?.type !== "braceClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '}'" }, { location: { file: absPath } });
    }
    cursor++;
    return obj;
  }

  function parseArray(): unknown[] { // Note: arbitrary JSON AST node value
    if (tokens[cursor]?.type !== "bracketOpen") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected '['" }, { location: { file: absPath } });
    }
    cursor++;
    const arr: unknown[] = []; // Note: arbitrary JSON AST node value

    while (cursor < tokens.length && tokens[cursor]!.type !== "bracketClose") {
      if (tokens[cursor]!.type === "comma") {
        cursor++;
        continue;
      }
      arr.push(parseValue());
      if (tokens[cursor]?.type === "comma") {
        cursor++;
      } else if (tokens[cursor]?.type !== "bracketClose") {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: `Expected ',' or ']' in array, found "${tokens[cursor]?.value}"` },
          { location: { file: absPath } },
        );
      }
    }

    if (tokens[cursor]?.type !== "bracketClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected ']'" }, { location: { file: absPath } });
    }
    cursor++;
    return arr;
  }

  const result = parseObject();

  if (isDefineConfig) {
    if (tokens[cursor]?.type !== "parenClose") {
      throw createError(ErrorCode.CC1006, { path: absPath, reason: "Expected ')' after defineConfig" }, { location: { file: absPath } });
    }
    cursor++;
  }

  if (tokens[cursor]?.type === "semicolon") cursor++;

  while (cursor < tokens.length && tokens[cursor]!.type === "comment") cursor++;

  if (cursor < tokens.length) {
    throw createError(
      ErrorCode.CC1006,
      { path: absPath, reason: `Unexpected trailing content: "${tokens[cursor]!.value}"` },
      { location: { file: absPath } },
    );
  }

  return result;
}
