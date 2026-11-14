import type { Point } from "../renderer/shapes/primitives.js";
import type { Rgba } from "../renderer/color/types.js";

export type SvgPathKind = "M" | "L" | "C" | "Q" | "A" | "Z";

export interface SvgPathCommand {
  readonly kind: SvgPathKind;
  readonly points: readonly Point[];
  readonly rx?: number;
  readonly ry?: number;
  readonly rotation?: number;
  readonly largeArc?: boolean;
  readonly sweep?: boolean;
}

export interface SvgElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: readonly SvgElement[];
  readonly paths: readonly SvgPathCommand[];
  readonly styles: Record<string, string>;
  readonly defs?: SvgDefs;
}

export interface SvgGradientStop {
  readonly offset: number;
  readonly color: Rgba;
}

export interface SvgGradient {
  readonly id: string;
  readonly kind: "linear" | "radial";
  readonly stops: readonly SvgGradientStop[];
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly gradientUnits: "objectBoundingBox" | "userSpaceOnUse";
}

export interface SvgDefs {
  readonly gradients: ReadonlyMap<string, SvgGradient>;
  readonly clipPaths: ReadonlyMap<string, readonly SvgElement[]>;
}
