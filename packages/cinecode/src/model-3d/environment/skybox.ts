import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { CubeFace, CubeTexture } from "./cubeMap.js";

export interface SkyboxOptions {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  readonly exposure?: number;
  readonly tint?: readonly [number, number, number];
}

const PANORAMA: readonly CubeFace[] = ["posX", "posZ", "negX", "negZ"];

export function renderSkybox(
  ctx: SKRSContext2D,
  cubeTex: CubeTexture,
  width: number,
  height: number,
  options: SkyboxOptions = {},
): void {
  const exposure = Math.max(0, options.exposure !== undefined ? Math.pow(2, options.exposure) : 1);
  const yaw = normalizeTurns((options.rotationY !== undefined ? options.rotationY / (Math.PI * 2) : 0) + (options.yaw ?? 0));
  const pitch = Math.max(-1, Math.min(1, (options.rotationX !== undefined ? options.rotationX / (Math.PI / 2) : 0) + (options.pitch ?? 0)));
  const panelWidth = width / PANORAMA.length;
  const panelHeight = height * (1 - Math.abs(pitch) * 0.35);
  const offsetY = (height - panelHeight) / 2 + pitch * height * 0.25;
  const shift = Math.round(yaw * PANORAMA.length);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  for (let index = 0; index < PANORAMA.length; index += 1) {
    const face = PANORAMA[(index + shift) % PANORAMA.length]!;
    const image = cubeTex.faces.get(face);
    if (!image) continue;
    ctx.drawImage(image, index * panelWidth, offsetY, panelWidth + 0.5, panelHeight);
  }

  const top = cubeTex.faces.get("posY");
  if (top) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(top, 0, 0, width, Math.max(0, offsetY + 1));
  }
  const bottom = cubeTex.faces.get("negY");
  if (bottom) {
    ctx.globalAlpha = 0.85;
    const bottomHeight = Math.max(0, height - (offsetY + panelHeight));
    ctx.drawImage(bottom, 0, offsetY + panelHeight, width, bottomHeight);
  }

  if (exposure !== 1) {
    ctx.globalAlpha = Math.max(0, Math.min(1, Math.abs(exposure - 1)));
    ctx.fillStyle = exposure > 1 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, width, height);
  }

  if (options.tint) {
    const [tr, tg, tb] = options.tint;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = `rgb(${Math.round(tr * 255)}, ${Math.round(tg * 255)}, ${Math.round(tb * 255)})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function createProceduralSkybox(width = 1024, height = 512): CubeTexture {
  const faces = new Map<CubeFace, Canvas>();
  for (const face of ["posX", "negX", "posY", "negY", "posZ", "negZ"] as const) {
    const canvas = new Canvas(256, 256);
    const ctx = canvas.getContext("2d");
    if (face === "posY") {
      ctx.fillStyle = "#7fb6e8";
    } else if (face === "negY") {
      ctx.fillStyle = "#3b4a56";
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, "#6fa8dc");
      gradient.addColorStop(1, "#e8d9c0");
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, 256, 256);
    faces.set(face, canvas);
  }
  void width;
  void height;
  return { faces, size: 256 };
}

function normalizeTurns(value: number): number {
  const turns = value % 1;
  return turns < 0 ? turns + 1 : turns;
}
