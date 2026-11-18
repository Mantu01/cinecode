import { Canvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";

export interface TransitionContext {
  readonly progress: number;
  readonly from: Canvas;
  readonly to: Canvas;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

export interface TransitionParamSpec {
  readonly default: unknown;
  readonly type: "number" | "string" | "boolean";
  readonly min?: number;
  readonly max?: number;
  readonly choices?: readonly string[];
  readonly description?: string;
}

export interface TransitionApplyContext extends TransitionContext {
  readonly ctx: SKRSContext2D;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TransitionProcessor {
  readonly name: string;
  readonly defaultDuration?: number;
  readonly params?: Readonly<Record<string, TransitionParamSpec>>;
  readonly apply: (ctx: SKRSContext2D, context: TransitionContext, params: Record<string, unknown>) => void;
}

export interface TransitionDefinition {
  readonly name: string;
  readonly duration?: number;
  readonly params?: Readonly<Record<string, TransitionParamSpec>>;
  readonly process?: (ctx: SKRSContext2D, context: TransitionContext, params: Record<string, unknown>) => void;
  readonly apply?: (context: TransitionApplyContext) => void;
}

export function resolveTransitionParams(
  specs: Readonly<Record<string, TransitionParamSpec>> | undefined,
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs ?? {})) {
    result[name] = spec.default;
  }
  for (const [name, value] of Object.entries(params)) {
    const spec = specs?.[name];
    if (!spec) {
      result[name] = value;
      continue;
    }
    if (spec.type === "number" && typeof value !== "number") {
      throw new Error(`Transition parameter "${name}" must be a number`);
    }
    if (spec.type === "string" && typeof value !== "string") {
      throw new Error(`Transition parameter "${name}" must be a string`);
    }
    if (spec.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`Transition parameter "${name}" must be a boolean`);
    }
    if (spec.type === "number" && typeof value === "number") {
      if (spec.min !== undefined && value < spec.min) throw new Error(`Transition parameter "${name}" must be >= ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) throw new Error(`Transition parameter "${name}" must be <= ${spec.max}`);
    }
    if (spec.choices && typeof value === "string" && !spec.choices.includes(value)) {
      throw new Error(`Transition parameter "${name}" must be one of: ${spec.choices.join(", ")}`);
    }
    result[name] = value;
  }
  return result;
}

export function defineTransition(def: TransitionDefinition): TransitionProcessor {
  if (!def.process && !def.apply) {
    throw new Error(`Transition "${def.name}" must implement process() or apply()`);
  }
  return {
    name: def.name,
    defaultDuration: def.duration,
    params: def.params,
    apply: (ctx, context, params) => {
      const resolved = resolveTransitionParams(def.params, params);
      if (def.apply) {
        def.apply({ ...context, ctx, params: resolved });
        return;
      }
      def.process?.(ctx, context, resolved);
    },
  };
}

export function crossfade(ctx: SKRSContext2D, context: TransitionContext): void {
  ctx.save();
  ctx.globalAlpha = 1 - context.progress;
  ctx.drawImage(context.from, 0, 0);
  ctx.globalAlpha = context.progress;
  ctx.drawImage(context.to, 0, 0);
  ctx.restore();
}

export function wipe(
  ctx: SKRSContext2D,
  context: TransitionContext,
  direction: "left" | "right" | "up" | "down" | "diagonal" = "left",
  softness = 0,
): void {
  const { progress, from, to, width, height } = context;
  ctx.save();
  ctx.drawImage(from, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  const edge = progress * (direction === "diagonal" ? Math.max(width, height) : direction === "left" || direction === "right" ? width : height);
  if (direction === "left") {
    ctx.rect(0, 0, edge, height);
  } else if (direction === "right") {
    ctx.rect(width - edge, 0, edge, height);
  } else if (direction === "up") {
    ctx.rect(0, 0, width, edge);
  } else if (direction === "down") {
    ctx.rect(0, height - edge, width, edge);
  } else {
    ctx.moveTo(0, 0);
    ctx.lineTo(edge, 0);
    ctx.lineTo(0, edge);
    ctx.closePath();
  }
  if (softness > 0) {
    const grad = ctx.createLinearGradient(0, 0, softness, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = grad;
  }
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();
}

export function push(
  ctx: SKRSContext2D,
  context: TransitionContext,
  direction: "left" | "right" | "up" | "down" = "left",
): void {
  const { progress, from, to, width, height } = context;
  const offset = progress * (direction === "left" || direction === "right" ? width : height);
  ctx.save();
  if (direction === "left") {
    ctx.drawImage(from, -offset, 0);
    ctx.drawImage(to, width - offset, 0);
  } else if (direction === "right") {
    ctx.drawImage(from, offset, 0);
    ctx.drawImage(to, -width + offset, 0);
  } else if (direction === "up") {
    ctx.drawImage(from, 0, -offset);
    ctx.drawImage(to, 0, height - offset);
  } else {
    ctx.drawImage(from, 0, offset);
    ctx.drawImage(to, 0, -height + offset);
  }
  ctx.restore();
}

export function slide(
  ctx: SKRSContext2D,
  context: TransitionContext,
  direction: "left" | "right" | "up" | "down" = "left",
): void {
  const { progress, from, to, width, height } = context;
  const offset = progress * (direction === "left" || direction === "right" ? width : height);
  ctx.save();
  ctx.drawImage(from, 0, 0);
  if (direction === "left") {
    ctx.drawImage(to, width - offset, 0);
  } else if (direction === "right") {
    ctx.drawImage(to, -width + offset, 0);
  } else if (direction === "up") {
    ctx.drawImage(to, 0, height - offset);
  } else {
    ctx.drawImage(to, 0, -height + offset);
  }
  ctx.restore();
}

export function iris(
  ctx: SKRSContext2D,
  context: TransitionContext,
  softness = 0,
): void {
  const { progress, from, to, width, height } = context;
  const maxRadius = Math.hypot(width, height) / 2;
  const radius = progress * maxRadius;
  ctx.save();
  ctx.drawImage(from, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  if (softness > 0) {
    const grad = ctx.createRadialGradient(width / 2, height / 2, Math.max(0, radius - softness), width / 2, height / 2, radius);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = grad;
  }
  ctx.clip();
  ctx.drawImage(to, 0, 0);
  ctx.restore();
}

export const BUILTIN_TRANSITIONS: TransitionProcessor[] = [
  defineTransition({
    name: "crossfade",
    params: {},
    process: crossfade,
  }),
  defineTransition({
    name: "wipe",
    params: { direction: { default: "left", type: "string" }, softness: { default: 0, type: "number" } },
    process: (ctx, context, params) => wipe(ctx, context, params.direction as "left" | "right" | "up" | "down" | "diagonal", params.softness as number),
  }),
  defineTransition({
    name: "push",
    params: { direction: { default: "left", type: "string" } },
    process: (ctx, context, params) => push(ctx, context, params.direction as "left" | "right" | "up" | "down"),
  }),
  defineTransition({
    name: "slide",
    params: { direction: { default: "left", type: "string" } },
    process: (ctx, context, params) => slide(ctx, context, params.direction as "left" | "right" | "up" | "down"),
  }),
  defineTransition({
    name: "iris",
    params: { softness: { default: 0, type: "number" } },
    process: (ctx, context, params) => iris(ctx, context, params.softness as number),
  }),
];