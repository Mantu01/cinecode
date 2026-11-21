import type { InferredCinecodeConfig } from "./zod-schema.js";
import { defineConfig as coreDefineConfig } from "../core/define/definitions.js";

export function defineConfig(config: InferredCinecodeConfig): InferredCinecodeConfig {
  return coreDefineConfig(config);
}
