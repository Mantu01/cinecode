import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Point } from "../renderer/shapes/primitives.js";
import type { SvgPathCommand } from "./types.js";

export interface SvgBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function tracePath(ctx: SKRSContext2D, commands: readonly SvgPathCommand[]): void {
  let current: Point = { x: 0, y: 0 };
  for (const command of commands) {
    const points = command.points;
    switch (command.kind) {
      case "M":
        current = points[0]!;
        ctx.moveTo(current.x, current.y);
        break;
      case "L":
        current = points[0]!;
        ctx.lineTo(current.x, current.y);
        break;
      case "C":
        ctx.bezierCurveTo(points[0]!.x, points[0]!.y, points[1]!.x, points[1]!.y, points[2]!.x, points[2]!.y);
        current = points[2]!;
        break;
      case "Q":
        ctx.quadraticCurveTo(points[0]!.x, points[0]!.y, points[1]!.x, points[1]!.y);
        current = points[1]!;
        break;
      case "A": {
        const end = points[points.length - 1]!;
        traceArc(ctx, current, command, end);
        current = end;
        break;
      }
      case "Z":
        ctx.closePath();
        break;
    }
  }
}

function traceArc(ctx: SKRSContext2D, from: Point, command: SvgPathCommand, to: Point): void {
  const rx = command.rx ?? 0;
  const ry = command.ry ?? 0;
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    ctx.lineTo(to.x, to.y);
    return;
  }
  const phi = ((command.rotation ?? 0) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const absRx = Math.abs(rx);
  const absRy = Math.abs(ry);
  const lambda = (x1p * x1p) / (absRx * absRx) + (y1p * y1p) / (absRy * absRy);
  let correctedRx = absRx;
  let correctedRy = absRy;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    correctedRx *= scale;
    correctedRy *= scale;
  }
  const largeArc = command.largeArc === true;
  const sweep = command.sweep === true;
  const sign = largeArc !== sweep ? 1 : -1;
  const numerator = correctedRx * correctedRx * correctedRy * correctedRy
    - correctedRx * correctedRx * y1p * y1p
    - correctedRy * correctedRy * x1p * x1p;
  const denominator = correctedRx * correctedRx * y1p * y1p + correctedRy * correctedRy * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * correctedRx * y1p) / correctedRy;
  const cyp = (-coefficient * correctedRy * x1p) / correctedRx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const theta1 = angleBetween(1, 0, (x1p - cxp) / correctedRx, (y1p - cyp) / correctedRy);
  let deltaTheta = angleBetween(
    (x1p - cxp) / correctedRx,
    (y1p - cyp) / correctedRy,
    (-x1p - cxp) / correctedRx,
    (-y1p - cyp) / correctedRy,
  );
  if (!sweep && deltaTheta > 0) deltaTheta -= Math.PI * 2;
  if (sweep && deltaTheta < 0) deltaTheta += Math.PI * 2;
  ctx.ellipse(cx, cy, correctedRx, correctedRy, phi, theta1, theta1 + deltaTheta, !sweep);
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const lengths = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const clamped = Math.min(1, Math.max(-1, dot / lengths));
  const angle = Math.acos(clamped);
  return ux * vy - uy * vx >= 0 ? angle : -angle;
}

export function pathBoundingBox(commands: readonly SvgPathCommand[]): SvgBoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const command of commands) {
    for (const point of command.points) {
      expand(point.x, point.y);
    }
    if (command.kind === "A" && command.rx !== undefined && command.ry !== undefined && command.points.length > 0) {
      const end = command.points[command.points.length - 1]!;
      expand(end.x - command.rx, end.y - command.ry);
      expand(end.x + command.rx, end.y + command.ry);
    }
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

const SVG_TRANSFORM_PATTERN = /(\w+)\s*\(([^)]*)\)/g;
const NUMBER_PATTERN = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export function parseTransformList(transform: string | undefined): readonly { name: string; args: readonly number[] }[] {
  if (transform === undefined || transform.length === 0) return [];
  const list: { name: string; args: number[] }[] = [];
  SVG_TRANSFORM_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SVG_TRANSFORM_PATTERN.exec(transform)) !== null) {
    NUMBER_PATTERN.lastIndex = 0;
    const args: number[] = [];
    let numberMatch: RegExpExecArray | null;
    while ((numberMatch = NUMBER_PATTERN.exec(match[2]!)) !== null) {
      args.push(Number.parseFloat(numberMatch[0]));
    }
    list.push({ name: match[1]!.toLowerCase(), args });
  }
  return list;
}

export function applySvgTransform(ctx: SKRSContext2D, transform: string | undefined): void {
  for (const entry of parseTransformList(transform)) {
    const [a = 0, b = 0] = entry.args;
    switch (entry.name) {
      case "translate":
        ctx.translate(a, b);
        break;
      case "scale":
        ctx.scale(a, entry.args.length > 1 ? entry.args[1]! : a);
        break;
      case "rotate": {
        const angle = (a * Math.PI) / 180;
        if (entry.args.length > 2) {
          ctx.translate(entry.args[1]!, entry.args[2]!);
          ctx.rotate(angle);
          ctx.translate(-entry.args[1]!, -entry.args[2]!);
        } else {
          ctx.rotate(angle);
        }
        break;
      }
      case "matrix": {
        const [m0, m1, m2, m3, m4, m5] = entry.args;
        ctx.transform(m0!, m1!, m2!, m3!, m4!, m5!);
        break;
      }
      case "skewx":
        ctx.transform(1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0);
        break;
      case "skewy":
        ctx.transform(1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0);
        break;
    }
  }
}
