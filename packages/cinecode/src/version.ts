import { BUILD_VERSION } from "./version.generated.js";

// Build-time constant; no filesystem walking or dynamic parsing at import.
export const CINECODE_VERSION = BUILD_VERSION || "1.0.0";
