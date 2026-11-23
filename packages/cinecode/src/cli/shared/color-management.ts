export type ColorManagementInput =
  | "srgb"
  | "linear"
  | {
      readonly workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg";
      readonly outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020";
      readonly enabled?: boolean;
    };

export function normalizeColorManagement(
  input: ColorManagementInput | undefined,
): { workingColorSpace?: "srgb" | "linear-srgb" | "rec709" | "acescg"; outputColorSpace?: "srgb" | "rec709" | "display-p3" | "rec2020"; enabled?: boolean } | undefined {
  if (!input) return undefined;
  if (typeof input === "string") {
    if (input === "linear") {
      return { workingColorSpace: "linear-srgb", outputColorSpace: "srgb", enabled: true };
    }
    return { workingColorSpace: "srgb", outputColorSpace: "srgb", enabled: true };
  }
  return input;
}
