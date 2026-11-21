import { parse } from "svg-parser";
import { createError, ErrorCode } from "../errors/index.js";
import type { SvgElement } from "./types.js";
import { buildElement, findRootSvg } from "./tree.js";
import { extractDefs } from "./defs.js";

export function parseSvgSource(svgString: string, sourcePath = "SVG source"): SvgElement {
  const tree = parse(svgString);
  if (!tree || typeof tree !== "object") {
    throw createError(ErrorCode.CC2003, { path: sourcePath, reason: "invalid SVG AST" }, {
      fixHint: "Check the SVG is well-formed XML with a single <svg> root.",
    });
  }
  const root = findRootSvg(tree);
  if (root === undefined) {
    throw createError(ErrorCode.CC2003, { path: sourcePath, reason: "no root <svg> element found" }, {
      fixHint: "Wrap the SVG content in a single <svg> root element.",
    });
  }
  const element = buildElement(root, {});
  return { ...element, defs: extractDefs(root) };
}
