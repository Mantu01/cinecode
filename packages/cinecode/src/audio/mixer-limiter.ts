export const LIMITER_CEILING = 0.95;
export const LIMITER_LOOKAHEAD_SECONDS = 0.001;
export const LIMITER_RELEASE_SECONDS = 0.1;

export interface BlockLimiter {
  processBlock(data: Float32Array, blockStart: number, frames: number): void;
  readonly peakAfter: number;
  readonly engaged: boolean;
  readonly limitedFrames: number;
}

export function createBlockLimiter(
  sampleRate: number,
  channels: number,
  totalFrames: number,
): BlockLimiter {
  const lookahead = Math.max(0, Math.min(Math.round(sampleRate * LIMITER_LOOKAHEAD_SECONDS), totalFrames - 1));
  if (lookahead === 0) {
    return {
      processBlock(): void {},
      peakAfter: 0,
      engaged: false,
      limitedFrames: 0,
    };
  }
  const delay = new Float32Array(lookahead * channels);
  const queueSize = lookahead + 1;
  const queue = new Float32Array(queueSize);
  const release = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
  let write = 0;
  let head = 0;
  let count = 0;
  let gain = 1;
  let rampStep = 0;
  let engaged = false;
  let limitedFrames = 0;
  let peakAfter = 0;

  return {
    processBlock(data: Float32Array, blockStart: number, frames: number): void {
      for (let frame = 0; frame < frames; frame += 1) {
        const base = (blockStart + frame) * channels;
        let peak = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const value = Math.abs(data[base + channel] ?? 0);
          if (value > peak) peak = value;
        }
        const required = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1;

        while (count > 0 && queue[(head + count - 1) % queueSize]! >= required) count -= 1;
        queue[(head + count) % queueSize] = required;
        count += 1;
        if (count > queueSize) {
          head = (head + 1) % queueSize;
          count -= 1;
        }
        const windowMin = queue[head]!;

        if (windowMin < gain) {
          if (rampStep === 0) rampStep = (gain - windowMin) / lookahead;
          gain = Math.max(windowMin, gain - rampStep);
        } else {
          rampStep = 0;
          gain += (windowMin - gain) * release;
          if (gain > windowMin) gain = windowMin;
        }

        const ringBase = write * channels;
        for (let channel = 0; channel < channels; channel += 1) {
          const delayed = delay[ringBase + channel]!;
          delay[ringBase + channel] = data[base + channel] ?? 0;
          let value = delayed * gain;
          if (value > LIMITER_CEILING) value = LIMITER_CEILING;
          else if (value < -LIMITER_CEILING) value = -LIMITER_CEILING;
          data[base + channel] = value;
          const abs = Math.abs(value);
          if (abs > peakAfter) peakAfter = abs;
        }
        write = (write + 1) % lookahead;

        if (gain < 0.9999) {
          engaged = true;
          limitedFrames += 1;
        }
      }
    },
    get peakAfter(): number {
      return peakAfter;
    },
    get engaged(): boolean {
      return engaged;
    },
    get limitedFrames(): number {
      return limitedFrames;
    },
  };
}
