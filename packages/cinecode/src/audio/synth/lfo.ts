import type { LFOOptions } from "../types.js";
import type { SeededRandom } from "../../core/random/index.js";

const TWO_PI = 2 * Math.PI;

export function createLFO(options: LFOOptions, sampleRate: number, _rng: SeededRandom): {
  process: (samples: number, output: Float32Array, offset: number) => void;
  setRate: (rate: number) => void;
  setDepth: (depth: number) => void;
  getPhase: () => number;
  reset: () => void;
} {
  const { shape, phase } = options;
  let { rate, depth } = options;
  let phaseAcc = phase * TWO_PI;
  const phaseInc = (rate / sampleRate) * TWO_PI;

  function generate(shape: LFOOptions["shape"], phase: number): number {
    switch (shape) {
      case "sine":
        return Math.sin(phase);
      case "square":
        return phase < Math.PI ? 1 : -1;
      case "triangle":
        if (phase < Math.PI) {
          return (2 * phase / Math.PI) - 1;
        }
        return 3 - (2 * phase / Math.PI);
      case "sawtooth":
        return (phase / Math.PI) - 1;
    }
  }

  return {
    process(samples: number, output: Float32Array, offset: number): void {
      for (let i = 0; i < samples; i++) {
        output[offset + i] = generate(shape, phaseAcc) * depth;
        phaseAcc += phaseInc;
        if (phaseAcc >= TWO_PI) phaseAcc -= TWO_PI;
      }
    },

    setRate(newRate: number): void {
      rate = newRate;
    },

    setDepth(newDepth: number): void {
      depth = newDepth;
    },

    getPhase(): number {
      return phaseAcc / TWO_PI;
    },

    reset(): void {
      phaseAcc = phase * TWO_PI;
    },
  };
}