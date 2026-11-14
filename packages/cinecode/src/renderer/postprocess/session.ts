import type { EffectInput } from "../../effects/engine.js";

export interface PostProcessEffect {
  readonly name: string;
  readonly priority: number;
  readonly apply: (input: EffectInput) => void;
}

export interface PostProcessSession {
  readonly effects: PostProcessEffect[];
  addEffect(effect: PostProcessEffect): void;
  clear(): void;
  apply(input: EffectInput): void;
}

export function createPostProcessSession(): PostProcessSession {
  const effects: PostProcessEffect[] = [];
  return {
    effects,
    addEffect(effect) {
      effects.push(effect);
    },
    clear() {
      effects.length = 0;
    },
    apply(input) {
      const ordered = [...effects].sort((left, right) => left.priority - right.priority);
      for (const effect of ordered) effect.apply(input);
    },
  };
}
