import type { SvgDefs, SvgElement, SvgGradient, SvgGradientStop } from "./types.js";
import type { Rgba } from "../renderer/color/types.js";
import { parseColor } from "../renderer/color/parse.js";
import { nodeAttr, nodeAttrNum, nodeAttrs, STYLE_PROPERTIES, type ParsedNode } from "./tree.js";
import { parseShapePaths } from "./path-data.js";

export function extractDefs(root: ParsedNode): SvgDefs {
  const gradients = new Map<string, SvgGradient>();
  const clipPaths = new Map<string, readonly SvgElement[]>();
  collectDefs(root, gradients, clipPaths);
  return { gradients, clipPaths };
}

function collectDefs(
  node: ParsedNode,
  gradients: Map<string, SvgGradient>,
  clipPaths: Map<string, readonly SvgElement[]>,
): void {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (child.tagName === "linearGradient" || child.tagName === "radialGradient") {
      const id = nodeAttr(child, "id");
      if (id !== undefined) {
        gradients.set(id, parseGradient(child, gradients));
      }
    } else if (child.tagName === "clipPath") {
      const id = nodeAttr(child, "id");
      if (id !== undefined) {
        clipPaths.set(id, collectClipShapes(child));
      }
    }
    collectDefs(child, gradients, clipPaths);
  }
}

function collectClipShapes(node: ParsedNode): SvgElement[] {
  const shapes: SvgElement[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    const attrs = nodeAttrs(child);
    const styles: Record<string, string> = {};
    for (const name of STYLE_PROPERTIES) {
      const value = attrs[name];
      if (value !== undefined) styles[name] = value;
    }
    shapes.push({ tag: child.tagName ?? "", attrs, children: [], paths: parseShapePaths(child.tagName ?? "", attrs), styles });
  }
  return shapes;
}

function parseGradient(node: ParsedNode, gradients: ReadonlyMap<string, SvgGradient>): SvgGradient {
  const kind = node.tagName === "radialGradient" ? "radial" : "linear";
  const gradientUnits = nodeAttr(node, "gradientUnits") === "userSpaceOnUse" ? "userSpaceOnUse" : "objectBoundingBox";
  const href = nodeAttr(node, "href") ?? nodeAttr(node, "xlink:href");
  const parent = href !== undefined && href.startsWith("#") ? gradients.get(href.slice(1)) : undefined;
  const stops = collectStops(node, parent);
  return {
    id: nodeAttr(node, "id") ?? "",
    kind,
    stops,
    x1: nodeAttrNum(node, "x1", 0),
    y1: nodeAttrNum(node, "y1", 0),
    x2: nodeAttrNum(node, "x2", 1),
    y2: nodeAttrNum(node, "y2", 0),
    cx: nodeAttrNum(node, "cx", 0.5),
    cy: nodeAttrNum(node, "cy", 0.5),
    r: nodeAttrNum(node, "r", 0.5),
    gradientUnits,
  };
}

function collectStops(node: ParsedNode, parent: SvgGradient | undefined): SvgGradientStop[] {
  const stops: SvgGradientStop[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element" || child.tagName !== "stop") continue;
    const offset = Math.min(1, Math.max(0, nodeAttrNum(child, "offset", 0)));
    const colorValue = nodeAttr(child, "stop-color") ?? "#000000";
    let color: Rgba;
    try {
      color = parseColor(colorValue);
    } catch {
      color = { r: 0, g: 0, b: 0, a: 1 };
    }
    const stopOpacity = nodeAttr(child, "stop-opacity");
    if (stopOpacity !== undefined) {
      const alpha = Number.parseFloat(stopOpacity);
      color = { ...color, a: color.a * (Number.isFinite(alpha) ? alpha : 1) };
    }
    stops.push({ offset, color });
  }
  if (stops.length === 0 && parent !== undefined) {
    return [...parent.stops];
  }
  return stops;
}
