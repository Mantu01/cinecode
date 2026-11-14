import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import {
  drawScaledContent,
  drawWindowShadow,
  renderOverlayCanvas,
  roundedRectPath,
  type OverlayContent,
  type Rect,
} from "./common.js";

export type BrowserChromeTheme = "macos-light" | "macos-dark" | "windows-light" | "windows-dark" | "minimal";

export interface BrowserChromeOptions extends OverlayContent {
  readonly theme?: BrowserChromeTheme;
  readonly url?: string;
  readonly tabTitle?: string;
  readonly showAddressBar?: boolean;
  readonly showTabs?: boolean;
  readonly borderRadius?: number;
  readonly shadow?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export interface BrowserChromeResult {
  readonly frameRect: Rect;
  readonly contentRect: Rect;
}

interface BrowserThemeColors {
  readonly window: string;
  readonly chrome: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly address: string;
  readonly addressText: string;
  readonly macos: boolean;
}

const THEMES: Readonly<Record<BrowserChromeTheme, BrowserThemeColors>> = {
  "macos-light": {
    window: "#ffffff", chrome: "#f0f0f2", text: "#1d1d1f", muted: "#6e6e73",
    border: "#d4d4d8", address: "#ffffff", addressText: "#3a3a3c", macos: true,
  },
  "macos-dark": {
    window: "#1e1e20", chrome: "#2c2c2e", text: "#f5f5f7", muted: "#98989d",
    border: "#3a3a3c", address: "#3a3a3c", addressText: "#e5e5ea", macos: true,
  },
  "windows-light": {
    window: "#ffffff", chrome: "#f3f3f3", text: "#1b1b1b", muted: "#5f5f5f",
    border: "#d6d6d6", address: "#ffffff", addressText: "#2b2b2b", macos: false,
  },
  "windows-dark": {
    window: "#202020", chrome: "#2b2b2b", text: "#ffffff", muted: "#a0a0a0",
    border: "#3c3c3c", address: "#1b1b1b", addressText: "#e0e0e0", macos: false,
  },
  minimal: {
    window: "#ffffff", chrome: "#ffffff", text: "#111111", muted: "#888888",
    border: "#e2e2e2", address: "#f5f5f5", addressText: "#333333", macos: false,
  },
};

const TRAFFIC_COLORS = ["#ff5f57", "#febc2e", "#28c840"] as const;

export function drawBrowserChrome(
  ctx: SKRSContext2D,
  options: BrowserChromeOptions = {},
): BrowserChromeResult {
  const content = options.content;
  const width = options.width ?? content?.width ?? 1280;
  const height = options.height ?? content?.height ?? 800;
  const theme = options.theme ?? "macos-light";
  const colors = THEMES[theme];
  const radius = options.borderRadius ?? (theme === "minimal" ? 4 : 10);
  const showTabs = options.showTabs !== false;
  const showAddressBar = options.showAddressBar !== false;
  const tabsHeight = showTabs ? (theme.startsWith("macos") ? 38 : 42) : 0;
  const addressHeight = showAddressBar ? 44 : 0;
  const chromeHeight = tabsHeight + addressHeight;
  const frameRect = { x: 0, y: 0, width, height };

  drawWindowShadow(ctx, 0, 0, width, height, radius, { enabled: options.shadow !== false });

  ctx.save();
  roundedRectPath(ctx, 0, 0, width, height, radius);
  ctx.clip();
  ctx.fillStyle = colors.window;
  ctx.fillRect(0, 0, width, height);

  if (showTabs) {
    ctx.fillStyle = colors.chrome;
    ctx.fillRect(0, 0, width, tabsHeight);
    drawTabBar(ctx, width, tabsHeight, colors, options.tabTitle ?? "New Tab", theme);
  }

  if (showAddressBar) {
    ctx.fillStyle = colors.chrome;
    ctx.fillRect(0, tabsHeight, width, addressHeight);
    drawAddressBar(ctx, tabsHeight, width, addressHeight, colors, options.url ?? "https://example.com");
  }

  const contentRect: Rect = {
    x: 1,
    y: chromeHeight,
    width: width - 2,
    height: height - chromeHeight - 1,
  };
  ctx.fillStyle = colors.window;
  ctx.fillRect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
  if (content) {
    drawScaledContent(ctx, content, contentRect, "cover");
  }

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  roundedRectPath(ctx, 0.5, 0.5, width - 1, height - 1, radius);
  ctx.stroke();
  ctx.restore();

  return { frameRect, contentRect };
}

function drawTabBar(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  colors: BrowserThemeColors,
  tabTitle: string,
  theme: BrowserChromeTheme,
): void {
  ctx.save();
  if (colors.macos) {
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.fillStyle = TRAFFIC_COLORS[index]!;
      ctx.arc(20 + index * 20, height / 2, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    const tabX = 96;
    const tabWidth = Math.min(220, width - tabX - 24);
    if (tabWidth > 60) {
      ctx.fillStyle = theme === "macos-dark" ? "#3a3a3c" : "#ffffff";
      roundedRectPath(ctx, tabX, 6, tabWidth, height - 12, 7);
      ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(truncate(ctx, tabTitle, tabWidth - 20), tabX + 10, height / 2);
    }
  } else {
    const tabWidth = Math.min(200, width * 0.3);
    ctx.fillStyle = theme === "minimal" ? colors.window : colors.chrome;
    roundedRectPath(ctx, 12, 8, tabWidth, height - 8, 6);
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(truncate(ctx, tabTitle, tabWidth - 20), 22, height / 2 + 2);
    if (theme !== "minimal") {
      ctx.fillStyle = colors.muted;
      const controls = ["–", "□", "×"];
      controls.forEach((control, index) => {
        ctx.font = "14px sans-serif";
        ctx.fillText(control, width - 96 + index * 30, height / 2 + 1);
      });
    }
  }
  ctx.restore();
}

function drawAddressBar(
  ctx: SKRSContext2D,
  offsetY: number,
  width: number,
  height: number,
  colors: BrowserThemeColors,
  url: string,
): void {
  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("‹", 20, offsetY + height / 2);
  ctx.fillText("›", 42, offsetY + height / 2);
  const pillX = 66;
  const pillWidth = width - pillX - 20;
  ctx.fillStyle = colors.address;
  roundedRectPath(ctx, pillX, offsetY + 8, pillWidth, height - 16, (height - 16) / 2);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = colors.addressText;
  ctx.font = "13px sans-serif";
  ctx.fillText(truncate(ctx, url, pillWidth - 60), pillX + 16, offsetY + height / 2);
  ctx.restore();
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

export function renderBrowserChrome(content: Canvas, options: Omit<BrowserChromeOptions, "content"> = {}): Canvas {
  const width = options.width ?? content.width;
  const height = options.height ?? content.height;
  return renderOverlayCanvas(width, height, (ctx) => {
    drawBrowserChrome(ctx, { ...options, content, width, height });
  });
}
