import type { Canvas } from "@napi-rs/canvas";
import { createError, ErrorCode } from "../../errors/index.js";
import { generateMarbleTexture, type MarbleTextureParams } from "./marble.js";
import { generateWoodTexture, type WoodTextureParams } from "./wood.js";
import { generateMetalTexture, type MetalTextureParams } from "./metal.js";
import { generateFabricTexture, type FabricTextureParams } from "./fabric.js";
import { generateConcreteTexture, type ConcreteTextureParams } from "./concrete.js";
import { generateWaterTexture, type WaterTextureParams } from "./water.js";

export * from "./marble.js";
export * from "./wood.js";
export * from "./metal.js";
export * from "./fabric.js";
export * from "./concrete.js";
export * from "./water.js";
export * from "./common.js";

export type ProceduralTextureType = "marble" | "wood" | "metal" | "fabric" | "concrete" | "water";

export interface ProceduralTextureParams {
  readonly marble?: MarbleTextureParams;
  readonly wood?: WoodTextureParams;
  readonly metal?: MetalTextureParams;
  readonly fabric?: FabricTextureParams;
  readonly concrete?: ConcreteTextureParams;
  readonly water?: WaterTextureParams;
}

export function generateTexture(
  type: ProceduralTextureType | string,
  width: number,
  height: number,
  params: Record<string, unknown> = {},
): Canvas {
  switch (type) {
    case "marble":
      return generateMarbleTexture(width, height, params as MarbleTextureParams);
    case "wood":
      return generateWoodTexture(width, height, params as WoodTextureParams);
    case "metal":
      return generateMetalTexture(width, height, params as MetalTextureParams);
    case "fabric":
      return generateFabricTexture(width, height, params as FabricTextureParams);
    case "concrete":
      return generateConcreteTexture(width, height, params as ConcreteTextureParams);
    case "water":
      return generateWaterTexture(width, height, params as WaterTextureParams);
    default:
      throw createError(ErrorCode.CC6201, { type });
  }
}
