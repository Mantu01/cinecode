import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  evaluateTypewriter,
  typewriterEvents,
  drawTypewriter,
  type TypewriterParams,
  type TypewriterState,
} from "./typewriter.js";
import {
  evaluateLetterScatter,
  drawLetterScatter,
  layoutLetters,
  type LetterScatterParams,
} from "./letter-scatter.js";
import {
  evaluateWordReveal,
  drawWordReveal,
  type WordRevealParams,
} from "./word-reveal.js";
import {
  evaluateKinetic,
  parseKineticMarkup,
  drawKinetic,
  type KineticParams,
} from "./kinetic.js";
import {
  evaluateCalligraphy,
  drawCalligraphy,
  type CalligraphyParams,
} from "./calligraphy.js";

export * from "./typewriter.js";
export * from "./letter-scatter.js";
export * from "./word-reveal.js";
export * from "./kinetic.js";
export * from "./calligraphy.js";

export type TypographyPreset = "typewriter" | "letter-scatter" | "word-reveal" | "kinetic" | "calligraphy";

export interface TypographyDrawRequest {
  readonly ctx: SKRSContext2D;
  readonly text: string;
  readonly timeSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly font?: string;
  readonly fillStyle?: string;
}

export interface TypographyAnimation {
  readonly preset: TypographyPreset;
  readonly config: Record<string, unknown>;
  readonly draw: (request: TypographyDrawRequest) => unknown;
}

export function createTypographyEffect(
  preset: TypographyPreset | string,
  config: Record<string, unknown> = {},
): TypographyAnimation {
  switch (preset) {
    case "typewriter":
      return {
        preset: "typewriter",
        config,
        draw: (request) => drawTypewriter(request.ctx, request.text, request.timeSeconds, {
          ...(config as TypewriterParams),
          x: request.x,
          y: request.y,
          font: request.font,
          fillStyle: request.fillStyle,
        }) as TypewriterState,
      };
    case "letter-scatter":
      return {
        preset: "letter-scatter",
        config,
        draw: (request) => {
          const layout = layoutLetters(request.ctx, request.text, { font: request.font });
          return drawLetterScatter(request.ctx, layout, request.timeSeconds, {
            x: request.x,
            y: request.y,
            font: request.font,
            fillStyle: request.fillStyle,
            params: config as LetterScatterParams,
          });
        },
      };
    case "word-reveal":
      return {
        preset: "word-reveal",
        config,
        draw: (request) => drawWordReveal(request.ctx, request.text, request.timeSeconds, {
          ...(config as WordRevealParams),
          x: request.x,
          y: request.y,
          font: request.font,
          fillStyle: request.fillStyle,
        }),
      };
    case "kinetic":
      return {
        preset: "kinetic",
        config,
        draw: (request) => drawKinetic(request.ctx, request.text, request.timeSeconds, {
          ...(config as KineticParams),
          x: request.x,
          y: request.y,
          fontFamily: request.font,
          fillStyle: request.fillStyle,
        }),
      };
    case "calligraphy":
      return {
        preset: "calligraphy",
        config,
        draw: (request) => drawCalligraphy(request.ctx, request.text, request.timeSeconds, {
          ...(config as CalligraphyParams),
          x: request.x,
          y: request.y,
          font: request.font,
        }),
      };
    default:
      throw new Error(`CC6301: Unknown typography preset: ${preset}`);
  }
}

export { evaluateTypewriter, typewriterEvents, evaluateLetterScatter, evaluateWordReveal, evaluateKinetic, parseKineticMarkup, evaluateCalligraphy };
