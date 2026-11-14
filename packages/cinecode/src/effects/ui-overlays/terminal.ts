import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { renderOverlayCanvas, roundedRectPath } from "./common.js";

export type TerminalTheme = "dark" | "light" | "solarized" | "monokai" | "dracula";

export interface TerminalOptions {
  readonly theme?: TerminalTheme;
  readonly promptString?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly title?: string;
  readonly padding?: number;
  readonly lineHeight?: number;
  readonly lines?: readonly string[];
  readonly text?: string;
  readonly width?: number;
  readonly height?: number;
  readonly typing?: boolean;
  readonly typingSpeed?: number;
  readonly timeSeconds?: number;
  readonly showTitleBar?: boolean;
}

export interface AnsiSegment {
  readonly text: string;
  readonly color: string;
  readonly background: string | null;
  readonly bold: boolean;
}

interface TerminalPalette {
  readonly window: string;
  readonly chrome: string;
  readonly text: string;
  readonly muted: string;
  readonly prompt: string;
  readonly ansi: readonly string[];
}

const ANSI_BASE = [
  "#000000", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
  "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
] as const;

const PALETTES: Readonly<Record<TerminalTheme, TerminalPalette>> = {
  dark: {
    window: "#0c0c0c", chrome: "#1f1f1f", text: "#d4d4d4", muted: "#8a8a8a", prompt: "#4ec9b0",
    ansi: ANSI_BASE,
  },
  light: {
    window: "#ffffff", chrome: "#f0f0f0", text: "#1f1f1f", muted: "#666666", prompt: "#0a7d68",
    ansi: ["#000000", "#c91b00", "#00c200", "#c7c400", "#0225c7", "#ca30c7", "#00c5c7", "#c7c7c7",
      "#686868", "#ff6e67", "#5ffa68", "#fffc67", "#6871ff", "#ff77ff", "#60fdff", "#ffffff"],
  },
  solarized: {
    window: "#002b36", chrome: "#073642", text: "#93a1a1", muted: "#586e75", prompt: "#2aa198",
    ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
  },
  monokai: {
    window: "#272822", chrome: "#1e1f1c", text: "#f8f8f2", muted: "#90908a", prompt: "#a6e22e",
    ansi: ["#272822", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f8f8f2",
      "#75715e", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f9f8f5"],
  },
  dracula: {
    window: "#282a36", chrome: "#21222c", text: "#f8f8f2", muted: "#6272a4", prompt: "#50fa7b",
    ansi: ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"],
  },
};

export function xterm256Color(index: number): string {
  if (index < 16) return ANSI_BASE[Math.max(0, index)]!;
  if (index < 232) {
    const value = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(value / 36)]!;
    const g = steps[Math.floor(value / 6) % 6]!;
    const b = steps[value % 6]!;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const grey = 8 + (index - 232) * 10;
  return `rgb(${grey}, ${grey}, ${grey})`;
}

export function parseAnsi(text: string, palette: readonly string[] = ANSI_BASE): readonly AnsiSegment[][] {
  const flat: AnsiSegment[] = [];
  let color = palette[7] ?? "#ffffff";
  let background: string | null = null;
  let bold = false;
  let buffer = "";

  const flush = (): void => {
    if (buffer.length > 0) {
      flat.push({ text: buffer, color: bold ? palette[15] ?? color : color, background, bold });
      buffer = "";
    }
  };

  const pattern = /\u001b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    buffer += text.slice(lastIndex, match.index);
    flush();
    const codes = (match[1] ?? "").split(";").filter((code) => code.length > 0).map(Number);
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index]!;
      if (code === 0) {
        color = palette[7] ?? "#ffffff";
        background = null;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = palette[7] ?? "#ffffff";
      } else if (code === 49) {
        background = null;
      } else if (code >= 30 && code <= 37) {
        color = palette[code - 30] ?? color;
      } else if (code >= 90 && code <= 97) {
        color = palette[code - 90 + 8] ?? color;
      } else if (code >= 40 && code <= 47) {
        background = palette[code - 40] ?? null;
      } else if (code >= 100 && code <= 107) {
        background = palette[code - 100 + 8] ?? null;
      } else if (code === 38 || code === 48) {
        const isForeground = code === 38;
        const mode = codes[index + 1];
        if (mode === 5) {
          const resolved = xterm256Color(codes[index + 2] ?? 0);
          if (isForeground) color = resolved;
          else background = resolved;
          index += 2;
        } else if (mode === 2) {
          const resolved = `rgb(${codes[index + 2] ?? 0}, ${codes[index + 3] ?? 0}, ${codes[index + 4] ?? 0})`;
          if (isForeground) color = resolved;
          else background = resolved;
          index += 4;
        }
      }
    }
    lastIndex = pattern.lastIndex;
  }
  buffer += text.slice(lastIndex);
  flush();

  const lines: AnsiSegment[][] = [];
  let currentLine: AnsiSegment[] = [];
  for (const segment of flat) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (part.length > 0) currentLine.push({ ...segment, text: part });
      if (index < parts.length - 1) {
        lines.push(currentLine);
        currentLine = [];
      }
    });
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

export function renderTerminal(options: TerminalOptions = {}): Canvas {
  const width = options.width ?? 800;
  const height = options.height ?? 480;
  return renderOverlayCanvas(width, height, (ctx) => {
    drawTerminal(ctx, { ...options, width, height });
  });
}

export function drawTerminal(ctx: SKRSContext2D, options: TerminalOptions = {}): void {
  const width = options.width ?? 800;
  const height = options.height ?? 480;
  const palette = PALETTES[options.theme ?? "dark"];
  const titleBar = options.showTitleBar === false ? 0 : 32;
  const radius = 10;
  const fontSize = options.fontSize ?? 14;
  const fontFamily = options.fontFamily ?? "monospace";
  const padding = options.padding ?? 18;
  const lineHeight = options.lineHeight ?? Math.round(fontSize * 1.5);
  const prompt = options.promptString ?? "$ ";
  const text = options.text ?? (options.lines ?? []).join("\n");
  const typingSpeed = options.typingSpeed ?? 40;
  const time = options.timeSeconds ?? Number.POSITIVE_INFINITY;
  const visibleText = options.typing === false || !Number.isFinite(time)
    ? text
    : text.slice(0, Math.floor(time * typingSpeed));

  ctx.save();
  roundedRectPath(ctx, 0, 0, width, height, radius);
  ctx.clip();
  ctx.fillStyle = palette.window;
  ctx.fillRect(0, 0, width, height);

  if (titleBar > 0) {
    ctx.fillStyle = palette.chrome;
    ctx.fillRect(0, 0, width, titleBar);
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.fillStyle = ["#ff5f57", "#febc2e", "#28c840"][index]!;
      ctx.arc(18 + index * 18, titleBar / 2, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = palette.muted;
    ctx.font = `12px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.title ?? "Terminal", width / 2, titleBar / 2);
    ctx.textAlign = "left";
  }

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";
  let y = titleBar + padding;
  const lines = parseAnsi(visibleText, palette.ansi);
  lines.forEach((segments) => {
    let x = padding;
    let firstSegment = true;
    for (const segment of segments) {
      if (firstSegment) {
        const promptWidth = ctx.measureText(prompt).width;
        ctx.fillStyle = palette.prompt;
        ctx.fillText(prompt, x, y);
        x += promptWidth;
        firstSegment = false;
      }
      const segmentWidth = ctx.measureText(segment.text).width;
      if (segment.background) {
        ctx.fillStyle = segment.background;
        ctx.fillRect(x, y - 1, segmentWidth, fontSize * 1.25);
      }
      ctx.fillStyle = segment.color;
      ctx.font = `${segment.bold ? "bold " : ""}${fontSize}px ${fontFamily}`;
      ctx.fillText(segment.text, x, y);
      x += segmentWidth;
    }
    y += lineHeight;
    if (y > height - padding) return;
  });

  ctx.restore();
}
