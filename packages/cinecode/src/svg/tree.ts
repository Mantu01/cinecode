import type { SvgElement } from "./types.js";
import { parseShapePaths } from "./path-data.js";

export interface ParsedNode {
  readonly type: string;
  readonly tagName?: string;
  readonly properties?: Record<string, string | number>;
  readonly children?: readonly ParsedNode[];
  readonly value?: string;
}

export const STYLE_PROPERTIES = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "fill-opacity",
  "transform",
  "display",
  "clip-path",
  "clip-rule",
  "fill-rule",
] as const;

export function findRootSvg(tree: { readonly children?: readonly ParsedNode[] }): ParsedNode | undefined {
  for (const child of tree.children ?? []) {
    if (child.type === "element" && child.tagName === "svg") return child;
    const nested = findRootSvg(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function nodeAttr(node: ParsedNode, name: string): string | undefined {
  const value = node.properties?.[name];
  return value === undefined ? undefined : String(value);
}

export function nodeAttrNum(node: ParsedNode, name: string, fallback: number): number {
  const value = nodeAttr(node, name);
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nodeAttrs(node: ParsedNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.properties ?? {})) {
    attrs[key] = String(value);
  }
  return attrs;
}

export function buildElement(
  node: ParsedNode,
  inherited: Readonly<Record<string, string>>,
): SvgElement {
  const attrs = nodeAttrs(node);
  const styles: Record<string, string> = { ...inherited };
  for (const declaration of parseInlineStyle(attrs.style)) {
    styles[declaration.name] = declaration.value;
  }
  for (const name of STYLE_PROPERTIES) {
    const value = attrs[name];
    if (value !== undefined) styles[name] = value;
  }

  const paths = parseShapePaths(node.tagName ?? "", attrs);
  const children: SvgElement[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (child.tagName === "defs" || child.tagName === "style") continue;
    children.push(buildElement(child, styles));
  }

  return { tag: node.tagName ?? "", attrs, children, paths, styles };
}

export function parseInlineStyle(style: string | undefined): readonly { name: string; value: string }[] {
  if (style === undefined || style.length === 0) return [];
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(":");
      if (colon === -1) return undefined;
      return { name: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
    })
    .filter((entry): entry is { name: string; value: string } => entry !== undefined);
}
