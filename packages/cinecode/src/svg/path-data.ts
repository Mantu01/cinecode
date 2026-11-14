import type { Point } from "../renderer/shapes/primitives.js";
import type { SvgPathCommand } from "./types.js";

const TOKEN_PATTERN = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
const NUMBER_PATTERN = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export function parsePathData(d: string): SvgPathCommand[] {
  const tokens = tokenize(d);
  if (tokens.length === 0) return [];
  const commands: SvgPathCommand[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let lastCubicControl: Point | undefined;
  let lastQuadControl: Point | undefined;
  let index = 0;
  let kind: string | undefined;
  let numbers: number[] = [];

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (typeof token === "string") {
      kind = token;
      numbers = [];
      index += 1;
    } else if (kind === undefined) {
      index += 1;
      continue;
    } else {
      numbers.push(token);
      index += 1;
      if (index < tokens.length && typeof tokens[index] !== "string") continue;
    }
    const consumed = consumeCommand(kind, numbers, cursor, subpathStart, lastCubicControl, lastQuadControl);
    if (consumed === undefined) {
      if (numbers.length === 0) continue;
      numbers = [];
      continue;
    }
    for (const command of consumed.commands) {
      commands.push(command);
    }
    cursor = consumed.cursor;
    subpathStart = consumed.subpathStart;
    lastCubicControl = consumed.lastCubicControl;
    lastQuadControl = consumed.lastQuadControl;
    if (consumed.remainingNumbers.length > 0) {
      numbers = [...consumed.remainingNumbers];
      if (kind === "M") kind = "L";
      else if (kind === "m") kind = "l";
      continue;
    }
    numbers = [];
  }
  return commands;
}

export function parseShapePaths(tag: string, attrs: Record<string, string>): SvgPathCommand[] {
  switch (tag) {
    case "path": {
      const d = attrs.d;
      return d === undefined ? [] : parsePathData(d);
    }
    case "rect":
      return rectCommands(attrs);
    case "circle":
      return ellipseCommands(attrs, "r", "r");
    case "ellipse":
      return ellipseCommands(attrs, "rx", "ry");
    case "line":
      return lineCommands(attrs);
    case "polygon":
    case "polyline":
      return pointListCommands(attrs.points ?? "", tag === "polygon");
    default:
      return [];
  }
}

interface ConsumeResult {
  readonly commands: readonly SvgPathCommand[];
  readonly cursor: Point;
  readonly subpathStart: Point;
  readonly lastCubicControl: Point | undefined;
  readonly lastQuadControl: Point | undefined;
  readonly remainingNumbers: readonly number[];
}

function consumeCommand(
  kind: string,
  numbers: readonly number[],
  cursor: Point,
  subpathStart: Point,
  lastCubicControl: Point | undefined,
  lastQuadControl: Point | undefined,
): ConsumeResult | undefined {
  const upper = kind.toUpperCase();
  const relative = kind !== upper;
  const dx = relative ? cursor.x : 0;
  const dy = relative ? cursor.y : 0;

  switch (upper) {
    case "M":
    case "L": {
      const n = numbers.slice(0, 2);
      if (n.length < 2) return undefined;
      const end = { x: n[0]! + dx, y: n[1]! + dy };
      const command: SvgPathCommand = { kind: upper === "M" ? "M" : "L", points: [end] };
      if (upper === "M") subpathStart = end;
      cursor = end;
      return { commands: [command], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: undefined, remainingNumbers: numbers.slice(2) };
    }
    case "H": {
      if (numbers.length < 1) return undefined;
      cursor = { x: numbers[0]! + dx, y: cursor.y };
      return { commands: [{ kind: "L", points: [cursor] }], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: undefined, remainingNumbers: numbers.slice(1) };
    }
    case "V": {
      if (numbers.length < 1) return undefined;
      cursor = { x: cursor.x, y: numbers[0]! + dy };
      return { commands: [{ kind: "L", points: [cursor] }], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: undefined, remainingNumbers: numbers.slice(1) };
    }
    case "C": {
      const n = numbers.slice(0, 6);
      if (n.length < 6) return undefined;
      const c1 = { x: n[0]! + dx, y: n[1]! + dy };
      const c2 = { x: n[2]! + dx, y: n[3]! + dy };
      const end = { x: n[4]! + dx, y: n[5]! + dy };
      cursor = end;
      return { commands: [{ kind: "C", points: [c1, c2, end] }], cursor, subpathStart, lastCubicControl: c2, lastQuadControl: undefined, remainingNumbers: numbers.slice(6) };
    }
    case "S": {
      const n = numbers.slice(0, 4);
      if (n.length < 4) return undefined;
      const c1 = lastCubicControl
        ? { x: 2 * cursor.x - lastCubicControl.x, y: 2 * cursor.y - lastCubicControl.y }
        : cursor;
      const c2 = { x: n[0]! + dx, y: n[1]! + dy };
      const end = { x: n[2]! + dx, y: n[3]! + dy };
      cursor = end;
      return { commands: [{ kind: "C", points: [c1, c2, end] }], cursor, subpathStart, lastCubicControl: c2, lastQuadControl: undefined, remainingNumbers: numbers.slice(4) };
    }
    case "Q": {
      const n = numbers.slice(0, 4);
      if (n.length < 4) return undefined;
      const cp = { x: n[0]! + dx, y: n[1]! + dy };
      const end = { x: n[2]! + dx, y: n[3]! + dy };
      cursor = end;
      return { commands: [{ kind: "Q", points: [cp, end] }], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: cp, remainingNumbers: numbers.slice(4) };
    }
    case "T": {
      const n = numbers.slice(0, 2);
      if (n.length < 2) return undefined;
      const cp = lastQuadControl
        ? { x: 2 * cursor.x - lastQuadControl.x, y: 2 * cursor.y - lastQuadControl.y }
        : cursor;
      const end = { x: n[0]! + dx, y: n[1]! + dy };
      cursor = end;
      return { commands: [{ kind: "Q", points: [cp, end] }], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: cp, remainingNumbers: numbers.slice(2) };
    }
    case "A": {
      const n = numbers.slice(0, 7);
      if (n.length < 7) return undefined;
      const end = { x: n[5]! + dx, y: n[6]! + dy };
      const command: SvgPathCommand = {
        kind: "A",
        points: [cursor, end],
        rx: n[0]!,
        ry: n[1]!,
        rotation: n[2]!,
        largeArc: n[3] !== 0,
        sweep: n[4] !== 0,
      };
      cursor = end;
      return { commands: [command], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: undefined, remainingNumbers: numbers.slice(7) };
    }
    case "Z": {
      cursor = { ...subpathStart };
      return { commands: [{ kind: "Z", points: [] }], cursor, subpathStart, lastCubicControl: undefined, lastQuadControl: undefined, remainingNumbers: [] };
    }
    default:
      return undefined;
  }
}

type SvgToken = string | number;

function tokenize(d: string): SvgToken[] {
  const tokens: SvgToken[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(d)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else {
      tokens.push(Number.parseFloat(match[2]!));
    }
  }
  return tokens;
}

function num(attrs: Record<string, string>, name: string, fallback = 0): number {
  const value = attrs[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rectCommands(attrs: Record<string, string>): SvgPathCommand[] {
  const x = num(attrs, "x");
  const y = num(attrs, "y");
  const width = num(attrs, "width");
  const height = num(attrs, "height");
  const rx = num(attrs, "rx", num(attrs, "ry", 0));
  const ry = num(attrs, "ry", rx);
  if (width <= 0 || height <= 0) return [];
  if (rx > 0 && ry > 0) {
    const crx = Math.min(rx, width / 2);
    const cry = Math.min(ry, height / 2);
    return [
      { kind: "M", points: [{ x: x + crx, y }] },
      { kind: "L", points: [{ x: x + width - crx, y }] },
      { kind: "A", points: [{ x: x + width, y: y + cry }], rx: crx, ry: cry, rotation: 0, largeArc: false, sweep: true },
      { kind: "L", points: [{ x: x + width, y: y + height - cry }] },
      { kind: "A", points: [{ x: x + width - crx, y: y + height }], rx: crx, ry: cry, rotation: 0, largeArc: false, sweep: true },
      { kind: "L", points: [{ x: x + crx, y: y + height }] },
      { kind: "A", points: [{ x, y: y + height - cry }], rx: crx, ry: cry, rotation: 0, largeArc: false, sweep: true },
      { kind: "L", points: [{ x, y: y + cry }] },
      { kind: "A", points: [{ x: x + crx, y }], rx: crx, ry: cry, rotation: 0, largeArc: false, sweep: true },
      { kind: "Z", points: [] },
    ];
  }
  return [
    { kind: "M", points: [{ x, y }] },
    { kind: "L", points: [{ x: x + width, y }] },
    { kind: "L", points: [{ x: x + width, y: y + height }] },
    { kind: "L", points: [{ x, y: y + height }] },
    { kind: "Z", points: [] },
  ];
}

function ellipseCommands(attrs: Record<string, string>, rxName: string, ryName: string): SvgPathCommand[] {
  const cx = num(attrs, "cx");
  const cy = num(attrs, "cy");
  const rx = num(attrs, rxName, 0);
  const ry = num(attrs, ryName, 0);
  if (rx <= 0 || ry <= 0) return [];
  return [
    { kind: "M", points: [{ x: cx - rx, y: cy }] },
    { kind: "A", points: [{ x: cx + rx, y: cy }], rx, ry, rotation: 0, largeArc: false, sweep: true },
    { kind: "A", points: [{ x: cx - rx, y: cy }], rx, ry, rotation: 0, largeArc: false, sweep: true },
    { kind: "Z", points: [] },
  ];
}

function lineCommands(attrs: Record<string, string>): SvgPathCommand[] {
  return [
    { kind: "M", points: [{ x: num(attrs, "x1"), y: num(attrs, "y1") }] },
    { kind: "L", points: [{ x: num(attrs, "x2"), y: num(attrs, "y2") }] },
  ];
}

function pointListCommands(points: string, close: boolean): SvgPathCommand[] {
  NUMBER_PATTERN.lastIndex = 0;
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = NUMBER_PATTERN.exec(points)) !== null) {
    values.push(Number.parseFloat(match[0]));
  }
  if (values.length < 2) return [];
  const commands: SvgPathCommand[] = [{ kind: "M", points: [{ x: values[0]!, y: values[1]! }] }];
  for (let i = 2; i + 1 < values.length; i += 2) {
    commands.push({ kind: "L", points: [{ x: values[i]!, y: values[i + 1]! }] });
  }
  if (close) {
    commands.push({ kind: "Z", points: [] });
  }
  return commands;
}
