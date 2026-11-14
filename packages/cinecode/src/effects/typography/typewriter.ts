import type { SKRSContext2D } from "@napi-rs/canvas";

export interface TypewriterParams {
  readonly speed?: number;
  readonly cursor?: boolean;
  readonly cursorChar?: string;
  readonly cursorBlinkRate?: number;
  readonly startDelay?: number;
}

export interface TypewriterState {
  readonly visibleText: string;
  readonly typedCharacters: number;
  readonly complete: boolean;
  readonly cursorVisible: boolean;
}

export interface TypewriterEvent {
  readonly character: string;
  readonly timeSeconds: number;
}

export function evaluateTypewriter(text: string, timeSeconds: number, params: TypewriterParams = {}): TypewriterState {
  const speed = Math.max(0.1, params.speed ?? 15);
  const startDelay = Math.max(0, params.startDelay ?? 0);
  const elapsed = Math.max(0, timeSeconds - startDelay);
  const typedCharacters = Math.min(text.length, Math.floor(elapsed * speed));
  const complete = typedCharacters >= text.length;
  const blinkRate = Math.max(0.1, params.cursorBlinkRate ?? 2);
  const cursorVisible = params.cursor === false ? false : Math.floor(timeSeconds * blinkRate * 2) % 2 === 0;
  return {
    visibleText: text.slice(0, typedCharacters),
    typedCharacters,
    complete,
    cursorVisible,
  };
}

export function typewriterEvents(text: string, params: TypewriterParams = {}): readonly TypewriterEvent[] {
  const speed = Math.max(0.1, params.speed ?? 15);
  const startDelay = Math.max(0, params.startDelay ?? 0);
  return [...text].map((character, index) => ({
    character,
    timeSeconds: startDelay + index / speed,
  }));
}

export interface TypewriterDrawOptions extends TypewriterParams {
  readonly x: number;
  readonly y: number;
  readonly font?: string;
  readonly fillStyle?: string;
  readonly cursorColor?: string;
}

export function drawTypewriter(
  ctx: SKRSContext2D,
  text: string,
  timeSeconds: number,
  options: TypewriterDrawOptions,
): TypewriterState {
  const state = evaluateTypewriter(text, timeSeconds, options);
  ctx.save();
  ctx.font = options.font ?? "32px sans-serif";
  ctx.fillStyle = options.fillStyle ?? "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(state.visibleText, options.x, options.y);
  if (state.cursorVisible) {
    const width = Math.max(2, ctx.measureText("M").width * 0.5);
    const metrics = ctx.measureText(state.visibleText);
    const cursorX = options.x + metrics.width + 2;
    ctx.fillStyle = options.cursorColor ?? options.fillStyle ?? "#ffffff";
    const height = Number.parseInt(ctx.font, 10) || 32;
    ctx.fillRect(cursorX, options.y - height * 0.8, width, height);
  }
  ctx.restore();
  return state;
}
