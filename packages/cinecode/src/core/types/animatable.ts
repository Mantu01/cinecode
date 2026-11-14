import type { ColorValue } from "./visual.js";

export type AnimatableValue = number | ColorValue | readonly number[] | { readonly x: number; readonly y: number };
