import type { OscillatorOptions } from "../types.js";
import type { SeededRandom } from "../../core/random/index.js";

const TWO_PI = 2 * Math.PI;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteToFrequency(note: string): number {
  const match = note.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid note name: ${note}`);
  }
  const letter = match[1]!;
  const accidental = match[2]!;
  const octaveStr = match[3]!;
  const octave = parseInt(octaveStr, 10);
  const naturalIndex = NOTE_NAMES.indexOf(letter.toUpperCase());
  if (naturalIndex === -1) {
    throw new Error(`Invalid note name: ${note}`);
  }
  const baseIndex = naturalIndex + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  if (baseIndex < 0 || baseIndex >= NOTE_NAMES.length) {
    throw new Error(`Invalid note name: ${note}`);
  }
  const semitone = baseIndex + (octave + 1) * 12;
  const a4Index = 9 + 5 * 12;
  const distance = semitone - a4Index;
  return 440 * Math.pow(2, distance / 12);
}

export function parseFrequency(value: number | string): number {
  if (typeof value === "number") return value;
  return noteToFrequency(value);
}

function generateSine(phase: number): number {
  return Math.sin(phase);
}

function generateSquare(phase: number, duty = 0.5): number {
  return phase < duty * TWO_PI ? 1 : -1;
}

function generateSawtooth(phase: number): number {
  return (phase / Math.PI) - 1;
}

function generateTriangle(phase: number): number {
  const halfPi = Math.PI;
  if (phase < halfPi) {
    return (2 * phase / halfPi) - 1;
  }
  return 3 - (2 * phase / halfPi);
}

function generateWhiteNoise(rng: SeededRandom): number {
  return rng.range(-1, 1);
}

function generatePinkNoise(rng: SeededRandom, state: number[]): number {
  const white = rng.range(-1, 1);
  state[0]! = 0.99765 * state[0]! + white * 0.0990460;
  state[1]! = 0.96300 * state[1]! + white * 0.2965164;
  state[2]! = 0.57000 * state[2]! + white * 1.0526913;
  state[3]! = 0.95000 * state[3]! + white * 0.3152587;
  return state[0]! + state[1]! + state[2]! + state[3]! + white * 0.0048303;
}

export function createOscillator(
  options: OscillatorOptions,
  rng: SeededRandom
): (samples: number, sampleRate: number, output: Float32Array, offset: number) => void {
  const { type, frequency, detune, unison, phase } = options;
  const baseFreq = frequency * Math.pow(2, detune / 1200);
  const phaseOffset = phase * TWO_PI;
  const pinkState = [0, 0, 0, 0];

  const voices = unison.voices > 0 ? unison.voices : 1;
  const voiceFreqs: number[] = [];
  const voicePan: number[] = [];

  for (let v = 0; v < voices; v++) {
    const spread = (v - (voices - 1) / 2) * unison.detune;
    voiceFreqs.push(baseFreq * Math.pow(2, spread / 1200));
    voicePan.push(unison.stereoWidth * (v / Math.max(1, voices - 1) - 0.5) * 2);
  }

  let phaseAcc = phaseOffset;

  return (samples: number, sampleRate: number, output: Float32Array, offset: number): void => {
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let v = 0; v < voices; v++) {
        const freq = voiceFreqs[v]!;
        const phaseInc = (freq / sampleRate) * TWO_PI;
        let value = 0;

        switch (type) {
          case "sine":
            value = generateSine(phaseAcc);
            break;
          case "square":
            value = generateSquare(phaseAcc);
            break;
          case "sawtooth":
            value = generateSawtooth(phaseAcc);
            break;
          case "triangle":
            value = generateTriangle(phaseAcc);
            break;
          case "white-noise":
            value = generateWhiteNoise(rng);
            break;
          case "pink-noise":
            value = generatePinkNoise(rng, pinkState);
            break;
        }

        sum += value;
        phaseAcc += phaseInc;
        if (phaseAcc >= TWO_PI) phaseAcc -= TWO_PI;
      }

      output[offset + i] = sum / Math.max(1, voices);
    }
  };
}