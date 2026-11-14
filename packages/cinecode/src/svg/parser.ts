import { parse } from "svg-parser";
import type { SvgElement } from "./types.js";
import { buildElement, findRootSvg } from "./tree.js";
import { extractDefs } from "./defs.js";

export function parseSvgSource(svgString: string): SvgElement {
  const tree = parse(svgString);
  const root = findRootSvg(tree);
  if (root === undefined) {
    throw new Error("Invalid SVG source: no root <svg> element found");
  }
  const element = buildElement(root, {});
  return { ...element, defs: extractDefs(root) };
}
