import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import {
  drawScaledContent,
  renderOverlayCanvas,
  roundedRectPath,
  type OverlayContent,
  type Rect,
} from "./common.js";

export type MobileDevice = "iphone-15" | "iphone-se" | "android-pixel" | "android-generic";
export type MobileFrameColor = "black" | "white" | "silver";
export type MobileOrientation = "portrait" | "landscape";

export interface MobileFrameOptions extends OverlayContent {
  readonly device?: MobileDevice;
  readonly color?: MobileFrameColor;
  readonly showStatusBar?: boolean;
  readonly orientation?: MobileOrientation;
  readonly statusBarTime?: string;
  readonly batteryPercent?: number;
  readonly signalStrength?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface MobileFrameResult {
  readonly bodyRect: Rect;
  readonly screenRect: Rect;
}

interface DeviceGeometry {
  readonly aspect: number;
  readonly screenCornerRatio: number;
  readonly sideBezel: number;
  readonly topBezel: number;
  readonly bottomBezel: number;
  readonly homeButton: boolean;
  readonly dynamicIsland: boolean;
  readonly punchHole: boolean;
}

const DEVICES: Readonly<Record<MobileDevice, DeviceGeometry>> = {
  "iphone-15": {
    aspect: 1179 / 2556, screenCornerRatio: 0.13, sideBezel: 0.028,
    topBezel: 0.028, bottomBezel: 0.028, homeButton: false, dynamicIsland: true, punchHole: false,
  },
  "iphone-se": {
    aspect: 750 / 1334, screenCornerRatio: 0.01, sideBezel: 0.045,
    topBezel: 0.075, bottomBezel: 0.12, homeButton: true, dynamicIsland: false, punchHole: false,
  },
  "android-pixel": {
    aspect: 1080 / 2400, screenCornerRatio: 0.08, sideBezel: 0.025,
    topBezel: 0.025, bottomBezel: 0.025, homeButton: false, dynamicIsland: false, punchHole: true,
  },
  "android-generic": {
    aspect: 1080 / 2340, screenCornerRatio: 0.07, sideBezel: 0.035,
    topBezel: 0.04, bottomBezel: 0.045, homeButton: false, dynamicIsland: false, punchHole: false,
  },
};

const BODY_COLORS: Readonly<Record<MobileFrameColor, { body: string; edge: string; screen: string }>> = {
  black: { body: "#1c1c1e", edge: "#3a3a3c", screen: "#000000" },
  white: { body: "#f2f2f4", edge: "#d0d0d4", screen: "#000000" },
  silver: { body: "#d7d9dc", edge: "#a8abb0", screen: "#000000" },
};

export function mobileFrameGeometry(
  device: MobileDevice,
  orientation: MobileOrientation,
  availableWidth: number,
  availableHeight: number,
): MobileFrameResult {
  const geometry = DEVICES[device];
  const aspect = orientation === "landscape" ? 1 / geometry.aspect : geometry.aspect;
  let bodyWidth = availableWidth * 0.82;
  let bodyHeight = bodyWidth / aspect;
  if (bodyHeight > availableHeight * 0.92) {
    bodyHeight = availableHeight * 0.92;
    bodyWidth = bodyHeight * aspect;
  }
  const bodyX = (availableWidth - bodyWidth) / 2;
  const bodyY = (availableHeight - bodyHeight) / 2;
  const side = bodyWidth * geometry.sideBezel;
  const top = bodyHeight * geometry.topBezel;
  const bottom = bodyHeight * geometry.bottomBezel;
  return {
    bodyRect: { x: bodyX, y: bodyY, width: bodyWidth, height: bodyHeight },
    screenRect: {
      x: bodyX + side,
      y: bodyY + top,
      width: bodyWidth - side * 2,
      height: bodyHeight - top - bottom,
    },
  };
}

export function drawMobileFrame(ctx: SKRSContext2D, options: MobileFrameOptions = {}): MobileFrameResult {
  const width = options.width ?? options.content?.width ?? 1080;
  const height = options.height ?? options.content?.height ?? 1920;
  const device = options.device ?? "iphone-15";
  const geometry = DEVICES[device];
  const palette = BODY_COLORS[options.color ?? "black"];
  const { bodyRect, screenRect } = mobileFrameGeometry(device, options.orientation ?? "portrait", width, height);
  const bodyRadius = bodyRect.width * (geometry.homeButton ? 0.09 : 0.14);
  const screenRadius = screenRect.width * geometry.screenCornerRatio;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = palette.body;
  roundedRectPath(ctx, bodyRect.x, bodyRect.y, bodyRect.width, bodyRect.height, bodyRadius);
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, bodyRect.x + 1, bodyRect.y + 1, bodyRect.width - 2, bodyRect.height - 2, bodyRadius);
  ctx.stroke();

  ctx.save();
  roundedRectPath(ctx, screenRect.x, screenRect.y, screenRect.width, screenRect.height, screenRadius);
  ctx.clip();
  ctx.fillStyle = palette.screen;
  ctx.fillRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
  if (options.content) {
    drawScaledContent(ctx, options.content, screenRect, "cover");
  }

  if (geometry.dynamicIsland) {
    const islandWidth = screenRect.width * 0.3;
    const islandHeight = Math.max(14, screenRect.height * 0.028);
    ctx.fillStyle = "#000000";
    roundedRectPath(
      ctx,
      screenRect.x + (screenRect.width - islandWidth) / 2,
      screenRect.y + screenRect.height * 0.012,
      islandWidth,
      islandHeight,
      islandHeight / 2,
    );
    ctx.fill();
  }

  if (geometry.punchHole) {
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    ctx.arc(screenRect.x + screenRect.width / 2, screenRect.y + screenRect.height * 0.025, screenRect.width * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }

  if (geometry.homeButton) {
    const speakerWidth = screenRect.width * 0.18;
    const speakerHeight = Math.max(4, screenRect.height * 0.006);
    ctx.fillStyle = "#3a3a3c";
    roundedRectPath(
      ctx,
      screenRect.x + (screenRect.width - speakerWidth) / 2,
      bodyRect.y + bodyRect.height * 0.035,
      speakerWidth,
      speakerHeight,
      speakerHeight / 2,
    );
    ctx.fill();
  }

  if (options.showStatusBar !== false) {
    drawStatusBar(ctx, screenRect, options);
  }

  ctx.restore();

  if (geometry.homeButton) {
    ctx.beginPath();
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 2;
    ctx.arc(
      bodyRect.x + bodyRect.width / 2,
      bodyRect.y + bodyRect.height - (bodyRect.height - screenRect.y - screenRect.height) / 2,
      bodyRect.width * 0.055,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.restore();
  return { bodyRect, screenRect };
}

function drawStatusBar(ctx: SKRSContext2D, screen: Rect, options: MobileFrameOptions): void {
  const fontSize = Math.max(10, screen.width * 0.035);
  const y = screen.y + screen.height * 0.045;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(options.statusBarTime ?? "9:41", screen.x + screen.width * 0.08, y);

  ctx.textAlign = "right";
  const batteryWidth = screen.width * 0.065;
  const batteryHeight = fontSize * 0.6;
  const batteryX = screen.x + screen.width - screen.width * 0.06 - batteryWidth;
  const batteryPercent = Math.max(0, Math.min(100, options.batteryPercent ?? 82));
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, fontSize * 0.06);
  roundedRectPath(ctx, batteryX, y - batteryHeight / 2, batteryWidth, batteryHeight, batteryHeight * 0.25);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(batteryX + 2, y - batteryHeight / 2 + 2, (batteryWidth - 4) * (batteryPercent / 100), batteryHeight - 4);
  ctx.fillRect(batteryX + batteryWidth + 1, y - batteryHeight * 0.2, fontSize * 0.08, batteryHeight * 0.4);

  const bars = Math.max(1, Math.min(4, Math.round((options.signalStrength ?? 0.8) * 4)));
  const barX = batteryX - screen.width * 0.12;
  for (let index = 0; index < 4; index += 1) {
    const barHeight = fontSize * (0.25 + index * 0.13);
    ctx.fillStyle = index < bars ? "#ffffff" : "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(barX + index * fontSize * 0.22, y + fontSize * 0.25 - barHeight, fontSize * 0.14, barHeight);
  }
  ctx.restore();
}

export function renderMobileFrame(content: Canvas, options: Omit<MobileFrameOptions, "content"> = {}): Canvas {
  const width = options.width ?? content.width;
  const height = options.height ?? content.height;
  return renderOverlayCanvas(width, height, (ctx) => {
    drawMobileFrame(ctx, { ...options, content, width, height });
  });
}
