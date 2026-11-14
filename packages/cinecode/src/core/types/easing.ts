export type EasingDescriptor =
  | { readonly kind: "linear" }
  | { readonly kind: "hold" }
  | { readonly kind: "ease"; readonly family: EaseFamily; readonly mode: EaseMode }
  | { readonly kind: "cubic-bezier"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: "spring"; readonly stiffness: number; readonly damping: number; readonly mass: number; readonly velocity?: number }
  | { readonly kind: "steps"; readonly count: number; readonly position: StepsPosition }
  | { readonly kind: "bezier-curve"; readonly points: readonly [number, number, number, number, number, number, number, number] };

export type EaseMode = "in" | "out" | "in-out";

export type EaseFamily = "sine" | "quad" | "cubic" | "quart" | "expo" | "back" | "elastic" | "bounce";

export type StepsPosition = "start" | "end" | "both" | "none";
