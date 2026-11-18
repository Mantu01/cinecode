import type { SKRSContext2D } from "@napi-rs/canvas";
import type { EffectProcessor, EffectInput } from "./engine.js";
import { parseColor } from "../renderer/color/parse.js";

export interface FilmBorderParams {
  mode?: "letterbox" | "pillarbox" | "cinema" | "vhs";
  barWidth?: number;
  barColor?: string;
  borderRadius?: number;
}

export interface FlareParams {
  intensity?: number;
  direction?: "horizontal" | "vertical" | "both";
  flareColor?: string;
  starPoints?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function filmBars(input: EffectInput, mode: string, barWidth: number, barColor: string, borderRadius: number): void {
  const ctx = input.ctx;
  const bar = parseColor(barColor);
  const barFill = `rgba(${bar.r}, ${bar.g}, ${bar.b}, 1)`;
  const horizontal = mode === "pillarbox";
  const totalBar = mode === "cinema"
    ? computeCinemaBarWidth(input.width, input.height)
    : clamp01(barWidth);
  const half = totalBar / 2;
  ctx.fillStyle = barFill;
  if (horizontal) {
    ctx.fillRect(0, 0, input.width * half, input.height);
    ctx.fillRect(input.width * (1 - half), 0, input.width * half, input.height);
  } else {
    ctx.fillRect(0, 0, input.width, input.height * half);
    ctx.fillRect(0, input.height * (1 - half), input.width, input.height * half);
  }
  if (borderRadius > 0 && half > 0) {
    drawRoundedActiveArea(ctx, input.width, input.height, barFill, borderRadius, half, horizontal);
  }
  if (mode === "vhs") drawVhsOverlay(ctx, input.width, input.height);
}

function computeCinemaBarWidth(width: number, height: number): number {
  const visible = Math.min(1, width / (2.39 * height));
  return Math.max(0, Math.min(0.5, (1 - visible) / 1));
}

function drawRoundedActiveArea(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  barColor: string,
  radius: number,
  half: number,
  horizontal: boolean,
): void {
  const x = horizontal ? width * half : 0;
  const y = horizontal ? 0 : height * half;
  const w = horizontal ? width * (1 - half * 2) : width;
  const h = horizontal ? height : height * (1 - half * 2);
  const r = Math.min(radius, w / 2, h / 2);
  ctx.save();
  ctx.fillStyle = barColor;
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();
}

function drawVhsOverlay(ctx: EffectInput["ctx"], width: number, height: number): void {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#ffffff";
  const band = Math.floor((Date.now() % 1000) / 1000 * height);
  ctx.fillRect(0, band, width, 3);
  ctx.restore();
}

export function filmBorder(input: EffectInput, params: FilmBorderParams): void {
  filmBars(
    input,
    params.mode ?? "letterbox",
    params.barWidth ?? 0.1,
    params.barColor ?? "#000000",
    params.borderRadius ?? 0,
  );
}

export function anamorphicFlare(input: EffectInput, params: FlareParams): void {
  const intensity = clamp01(params.intensity ?? 0.5);
  if (intensity === 0) return;
  const direction = params.direction ?? "horizontal";
  const flareColor = params.flareColor ?? "#ffffff";
  const starPoints = Math.max(2, Math.min(16, Math.round(params.starPoints ?? 6)));
  const spots = findBrightSpots(input);
  const ctx = input.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const spot of spots) {
    const localIntensity = intensity * spot.brightness;
    if (direction === "vertical" || direction === "both") {
      drawStreak(ctx, spot.x, spot.y, input.width, flareColor, localIntensity, true);
    }
    if (direction === "horizontal" || direction === "both") {
      drawStreak(ctx, spot.x, spot.y, input.width, flareColor, localIntensity, false);
    }
    if (direction === "both" && starPoints > 2) drawStarburst(ctx, spot, flareColor, localIntensity, starPoints);
  }
  ctx.restore();
}

interface BrightSpot {
  readonly x: number;
  readonly y: number;
  readonly brightness: number;
}

function findBrightSpots(input: EffectInput): readonly BrightSpot[] {
  const data = input.ctx.getImageData(0, 0, input.width, input.height).data;
  const step = 8;
  const spots: BrightSpot[] = [];
  const cellSize = Math.max(16, step * 2);
  for (let y = step / 2; y < input.height; y += cellSize) {
    for (let x = step / 2; x < input.width; x += cellSize) {
      let brightest = 0;
      for (let sy = -step; sy <= step; sy += step) {
        for (let sx = -step; sx <= step; sx += step) {
          const px = Math.max(0, Math.min(input.width - 1, Math.round(x + sx)));
          const py = Math.max(0, Math.min(input.height - 1, Math.round(y + sy)));
          const index = (py * input.width + px) * 4;
          const luminance = 0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!;
          brightest = Math.max(brightest, luminance);
        }
      }
      if (brightest > 180) {
        spots.push({ x, y, brightness: Math.min(1, (brightest - 180) / 75) });
      }
    }
  }
  return spots;
}

function drawStreak(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  canvasWidth: number,
  flareColor: string,
  intensity: number,
  vertical: boolean,
): void {
  const parsed = parseColor(flareColor);
  const length = canvasWidth * 0.6;
  const thickness = Math.max(2, canvasWidth * 0.02);
  if (!vertical) {
    const grad = ctx.createLinearGradient(x - length, y, x + length, y);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.4, `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, 0.1)`);
    grad.addColorStop(0.5, `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, 0.35)`);
    grad.addColorStop(0.6, `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, 0.1)`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = intensity * 0.3;
    ctx.fillStyle = grad;
    ctx.fillRect(x - length, y - thickness / 2, length * 2, thickness);
  } else {
    const grad = ctx.createLinearGradient(x, y - length * 0.4, x, y + length * 0.4);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, 0.2)`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = intensity * 0.25;
    ctx.fillStyle = grad;
    ctx.fillRect(x - thickness / 2, y - length * 0.4, thickness, length * 0.8);
  }
}

function drawStarburst(
  ctx: EffectInput["ctx"],
  spot: BrightSpot,
  flareColor: string,
  intensity: number,
  starPoints: number,
): void {
  const radius = 24;
  for (let i = 1; i < starPoints; i += 1) {
    const angle = (i * Math.PI) / starPoints;
    ctx.globalAlpha = intensity * 0.15;
    ctx.strokeStyle = flareColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(spot.x - Math.cos(angle) * radius, spot.y - Math.sin(angle) * radius);
    ctx.lineTo(spot.x + Math.cos(angle) * radius, spot.y + Math.sin(angle) * radius);
    ctx.stroke();
  }
}

export const filmBorderEffect: EffectProcessor = {
  name: "film-border",
  apply: (input, params) => {
    filmBorder(input, {
      mode: params.mode as "letterbox" | "pillarbox" | "cinema" | "vhs" | undefined,
      barWidth: params.barWidth as number | undefined,
      barColor: params.barColor as string | undefined,
      borderRadius: params.borderRadius as number | undefined,
    });
  },
};

export const anamorphicFlareEffect: EffectProcessor = {
  name: "anamorphic-flare",
  apply: (input, params) => {
    anamorphicFlare(input, {
      intensity: params.intensity as number | undefined,
      direction: params.direction as "horizontal" | "vertical" | "both" | undefined,
      flareColor: params.flareColor as string | undefined,
      starPoints: params.starPoints as number | undefined,
    });
  },
};

