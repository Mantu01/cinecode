declare module "svg-parser" {
  export interface SvgParserNode {
    type: "root" | "element" | "text";
    tagName?: string;
    properties?: Record<string, string | number>;
    children?: SvgParserNode[];
    value?: string;
    metadata?: string;
  }
  export function parse(source: string): SvgParserNode;
}
