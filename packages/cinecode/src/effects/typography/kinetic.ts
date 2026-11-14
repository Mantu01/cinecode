import type { SKRSContext2D } from "@napi-rs/canvas";
import { noise2d } from "../../core/random/index.js";

export type KineticStyle = "dramatic" | "playful" | "minimal" | "bold";

export interface KineticWordToken {
  readonly text: string;
  readonly emphasis: boolean;
  readonly whisper: boolean;
  readonly index: number;
}

export interface KineticParams {
  readonly style?: KineticStyle;
  readonly baseFontSize?: number;
  readonly emphasisScale?: number;
  readonly motionIntensity?: number;
  readonly stagger?: number;
  readonly duration?: number;
  readonly beats?: readonly number[];
  readonly seed?: number;
}

export interface KineticWordState extends KineticWordToken {
  readonly scale: number;
  readonly opacity: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly fontWeight: string;
  readonly progress: number;
}

export function parseKineticMarkup(text: string): readonly KineticWordToken[] {
  const tokens: KineticWordToken[] = [];
  const pattern = /(\*[^*]+\*|_[^_]+_)|([^\s*_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) {
      const emphasis = match[1].startsWith("*");
      const content = match[1].slice(1, -1);
      for (const word of content.split(/\s+/).filter(Boolean)) {
        tokens.push({ text: word, emphasis, whisper: !emphasis, index: tokens.length });
      }
    } else if (match[2]) {
      tokens.push({ text: match[2], emphasis: false, whisper: false, index: tokens.length });
    }
  }
  return tokens;
}

const STYLE_DEFAULTS: Readonly<Record<KineticStyle, { intensity: number; stagger: number; weight: string }>> = {
  dramatic: { intensity: 1.4, stagger: 0.16, weight: "700" },
  playful: { intensity: 1.8, stagger: 0.09, weight: "600" },
  minimal: { intensity: 0.5, stagger: 0.12, weight: "400" },
  bold: { intensity: 1.1, stagger: 0.14, weight: "900" },
};

export function evaluateKinetic(
  tokens: readonly KineticWordToken[],
  timeSeconds: number,
  params: KineticParams = {},
): readonly KineticWordState[] {
  const style = params.style ?? "dramatic";
  const defaults = STYLE_DEFAULTS[style];
  const emphasisScale = params.emphasisScale ?? 1.35;
  const intensity = (params.motionIntensity ?? 1) * defaults.intensity;
  const stagger = Math.max(0.01, params.stagger ?? defaults.stagger);
  const duration = Math.max(0.05, params.duration ?? 0.4);
  const seed = params.seed ?? 3;
  const beats = params.beats ?? [];

  return tokens.map((token, index) => {
    const start = token.index * stagger;
    const progress = Math.max(0, Math.min(1, (timeSeconds - start) / duration));
    const eased = progress * progress * (3 - 2 * progress);
    const beatPulse = beats.reduce((pulse, beat) => {
      const distance = Math.abs(timeSeconds - beat);
      return Math.max(pulse, Math.exp(-distance * 8));
    }, 0);
    const drift = noise2d(seed + index, timeSeconds * 0.6, index) * 2 - 1;
    return {
      ...token,
      progress,
      scale: (token.emphasis ? emphasisScale : 1) * (0.6 + 0.4 * eased) * (1 + beatPulse * 0.12 * intensity),
      opacity: token.whisper ? 0.55 * eased : eased,
      offsetX: drift * 8 * intensity * (1 - eased),
      offsetY: (1 - eased) * 20 * intensity,
      rotation: drift * 6 * intensity * (1 - eased),
      fontWeight: token.emphasis ? "900" : defaults.weight,
    };
  });
}

export interface KineticDrawOptions extends KineticParams {
  readonly x: number;
  readonly y: number;
  readonly fontFamily?: string;
  readonly fillStyle?: string;
  readonly emphasisColor?: string;
  readonly whisperColor?: string;
  readonly wordSpacing?: number;
}

export function drawKinetic(
  ctx: SKRSContext2D,
  text: string,
  timeSeconds: number,
  options: KineticDrawOptions,
): readonly KineticWordState[] {
  const tokens = parseKineticMarkup(text);
  const states = evaluateKinetic(tokens, timeSeconds, options);
  const baseFontSize = options.baseFontSize ?? 48;
  const fontFamily = options.fontFamily ?? "sans-serif";
  let cursorX = options.x;

  ctx.save();
  for (const state of states) {
    ctx.font = `${state.fontWeight} ${Math.round(baseFontSize * state.scale)}px ${fontFamily}`;
    const width = ctx.measureText(state.text).width;
    if (state.opacity > 0) {
      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.translate(cursorX + state.offsetX + width / 2, options.y + state.offsetY);
      ctx.rotate((state.rotation * Math.PI) / 180);
      ctx.fillStyle = state.whisper
        ? (options.whisperColor ?? "#8899aa")
        : state.emphasis
          ? (options.emphasisColor ?? options.fillStyle ?? "#ffffff")
          : (options.fillStyle ?? "#ffffff");
      ctx.fillText(state.text, -width / 2, 0);
      ctx.restore();
    }
    ctx.font = `${STYLE_DEFAULTS[options.style ?? "dramatic"].weight} ${baseFontSize}px ${fontFamily}`;
    cursorX += ctx.measureText(state.text).width + (options.wordSpacing ?? baseFontSize * 0.28);
  }
  ctx.restore();
  return states;
}
