import type { Composition } from "../core/types/index.js";
import { compositionTotalFrames } from "../core/time/index.js";

export class PreviewLoop {
  private readonly composition: Composition;

  constructor(composition: Composition, _onFrame: (payload: unknown) => void, _options: unknown = {}) {
    this.composition = composition;
  }

  totalFrames(): number {
    return compositionTotalFrames(this.composition);
  }

  start(): void {}
  stop(): void {}
  scrubTo(_frame: number): void {}
  setFps(_fps: number): void {}
  setPaused(_paused: boolean): void {}
  getScale(): number { return 1; }
  setScale(_scale: number): void {}
}
