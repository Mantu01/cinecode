import type { BeatEvent, TempoResult } from "./tempo.js";

export class BeatTracker {
  readonly bpm: number;
  readonly beats: readonly BeatEvent[];
  readonly confidence: number;
  private readonly period: number;
  private readonly phaseOffset: number;

  constructor(tempo: TempoResult) {
    this.bpm = tempo.bpm;
    this.beats = tempo.beats;
    this.confidence = tempo.confidence;
    this.period = tempo.bpm > 0 ? 60 / tempo.bpm : 0;
    this.phaseOffset = tempo.phaseOffset;
  }

  get isActive(): boolean {
    return this.period > 0;
  }

  getCurrentBeatPhase(time: number): number {
    if (this.period <= 0) return 0;
    const position = ((time - this.phaseOffset) / this.period) % 1;
    return position < 0 ? position + 1 : position;
  }

  nearestBeat(time: number): number {
    if (this.period <= 0) return time;
    const index = Math.round((time - this.phaseOffset) / this.period);
    return this.phaseOffset + index * this.period;
  }

  getBeatDelta(time: number): number {
    return time - this.nearestBeat(time);
  }

  isOnBeat(time: number, toleranceMs = 40): boolean {
    if (this.beats.length > 0) {
      return this.beats.some((beat) => Math.abs(beat.time - time) * 1000 <= toleranceMs);
    }
    return Math.abs(this.getBeatDelta(time)) * 1000 <= toleranceMs;
  }

  beatIndexAt(time: number): number {
    if (this.period <= 0) return 0;
    return Math.floor((time - this.phaseOffset) / this.period);
  }

  beatTimeAt(index: number): number {
    return this.phaseOffset + index * this.period;
  }
}
