import type { EnvelopeOptions } from "../types.js";

export type EnvelopeStage = "idle" | "attack" | "decay" | "sustain" | "release" | "done";

export interface EnvelopeState {
  readonly stage: EnvelopeStage;
  readonly value: number;
  readonly timeInStage: number;
}

export function createEnvelope(options: EnvelopeOptions): {
  process: (samples: number, sampleRate: number, gate: boolean, output: Float32Array, offset: number) => void;
  getState: () => EnvelopeState;
  reset: () => void;
} {
  const { attack, decay, sustain, release, curve } = options;
  const attackRate = attack > 0 ? 1 / attack : Infinity;
  const decayRate = decay > 0 ? (1 - sustain) / decay : Infinity;
  const releaseRate = release > 0 ? sustain / release : Infinity;

  let stage: EnvelopeStage = "idle";
  let value = 0;
  let timeInStage = 0;
  let gateActive = false;

  function computeValue(t: number, target: number, rate: number): number {
    if (curve === "exponential" && rate !== Infinity) {
      return target - (target - value) * Math.exp(-rate * t);
    }
    return Math.min(1, value + rate * t);
  }

  function computeDecayValue(t: number): number {
    if (curve === "exponential" && decayRate !== Infinity) {
      return sustain + (1 - sustain) * Math.exp(-decayRate * t);
    }
    return Math.max(sustain, 1 - decayRate * t);
  }

  function computeReleaseValue(t: number): number {
    if (curve === "exponential" && releaseRate !== Infinity) {
      return value * Math.exp(-releaseRate * t);
    }
    return Math.max(0, value - releaseRate * t);
  }

  return {
    process(samples: number, sampleRate: number, gate: boolean, output: Float32Array, offset: number): void {
      gateActive = gate;
      const dt = 1 / sampleRate;

      for (let i = 0; i < samples; i++) {
        switch (stage) {
          case "idle":
            if (gateActive) {
              stage = "attack";
              timeInStage = 0;
              value = 0;
            }
            output[offset + i] = 0;
            break;

          case "attack":
            timeInStage += dt;
            value = computeValue(timeInStage, 1, attackRate);
            output[offset + i] = value;
            if (timeInStage >= attack) {
              stage = "decay";
              timeInStage = 0;
              value = 1;
            }
            break;

          case "decay":
            timeInStage += dt;
            value = computeDecayValue(timeInStage);
            output[offset + i] = value;
            if (value <= sustain || timeInStage >= decay) {
              stage = "sustain";
              timeInStage = 0;
              value = sustain;
            }
            break;

          case "sustain":
            output[offset + i] = value;
            if (!gateActive) {
              stage = "release";
              timeInStage = 0;
            }
            break;

          case "release":
            timeInStage += dt;
            value = computeReleaseValue(timeInStage);
            output[offset + i] = value;
            if (value <= 0 || timeInStage >= release) {
              stage = "done";
              value = 0;
            }
            break;

          case "done":
            output[offset + i] = 0;
            break;
        }
      }
    },

    getState(): EnvelopeState {
      return { stage, value, timeInStage };
    },

    reset(): void {
      stage = "idle";
      value = 0;
      timeInStage = 0;
      gateActive = false;
    },
  };
}

export function createADSREnvelope(attack: number, decay: number, sustain: number, release: number): ReturnType<typeof createEnvelope> {
  return createEnvelope({ attack, decay, sustain, release, curve: "linear" });
}

export function createExponentialEnvelope(attack: number, decay: number, sustain: number, release: number): ReturnType<typeof createEnvelope> {
  return createEnvelope({ attack, decay, sustain, release, curve: "exponential" });
}