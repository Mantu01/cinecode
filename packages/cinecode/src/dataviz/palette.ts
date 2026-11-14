const DEFAULT_PALETTE: readonly string[] = [
  "#2196f3",
  "#4caf50",
  "#ff9800",
  "#e91e63",
  "#9c27b0",
  "#00bcd4",
  "#ffc107",
  "#795548",
  "#607d8b",
  "#3f51b5",
];

export function getColor(index: number, customColors?: readonly string[]): string {
  const palette = customColors !== undefined && customColors.length > 0 ? customColors : DEFAULT_PALETTE;
  const normalized = ((index % palette.length) + palette.length) % palette.length;
  return palette[normalized]!;
}

export function defaultPalette(): readonly string[] {
  return DEFAULT_PALETTE;
}
