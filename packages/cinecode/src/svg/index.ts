export type {
  SvgElement,
  SvgPathCommand,
  SvgPathKind,
  SvgDefs,
  SvgGradient,
  SvgGradientStop,
} from "./types.js";
export { parseSvgSource } from "./parser.js";
export {
  buildElement,
  findRootSvg,
  nodeAttr,
  nodeAttrNum,
  nodeAttrs,
  parseInlineStyle,
  STYLE_PROPERTIES,
  type ParsedNode,
} from "./tree.js";
export { parsePathData, parseShapePaths } from "./path-data.js";
export { extractDefs } from "./defs.js";
export { drawSvg, renderSvgToCanvas } from "./renderer.js";
export {
  applySvgTransform,
  parseTransformList,
  pathBoundingBox,
  tracePath,
  type SvgBoundingBox,
} from "./geometry.js";
export {
  serializeFrameToSvg,
  type SvgSerializerOptions,
} from "./serializer.js";


