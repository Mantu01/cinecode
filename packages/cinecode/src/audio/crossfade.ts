import type { AudioBuffer } from "./types.js";

export type CrossfadeCurve = "equal-power" | "linear" | "exponential" | "logarithmic" | "s-curve";

export interface CrossfadeGains {
  readonly outgoing: number;
  readonly incoming: number;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function crossfadeGains(curve: CrossfadeCurve, progress: number): CrossfadeGains {
  const t = Math.max(0, Math.min(1, progress));
  switch (curve) {
    case "linear":
      return { outgoing: 1 - t, incoming: t };
    case "exponential":
      return { outgoing: 1 - t * t, incoming: t * t };
    case "logarithmic":
      return { outgoing: 1 - Math.sqrt(t), incoming: Math.sqrt(t) };
    case "s-curve": {
      const eased = smoothStep(t);
      return { outgoing: 1 - eased, incoming: eased };
    }
    default:
      return {
        outgoing: Math.cos((t * Math.PI) / 2),
        incoming: Math.sin((t * Math.PI) / 2),
      };
  }
}

export function crossfadeCurveTable(curve: CrossfadeCurve, steps: number): readonly CrossfadeGains[] {
  const count = Math.max(1, Math.floor(steps));
  const table: CrossfadeGains[] = [];
  for (let index = 0; index <= count; index += 1) table.push(crossfadeGains(curve, index / count));
  return table;
}

export interface CrossfadeOptions {
  readonly curve?: CrossfadeCurve;
  readonly overlapSeconds?: number;
}

function readSample(buffer: AudioBuffer, frame: number, channel: number): number {
  if (frame < 0 || frame >= buffer.length) return 0;
  const sourceChannel = channel < buffer.channels ? channel : buffer.channels - 1;
  return buffer.data[frame * buffer.channels + sourceChannel] ?? 0;
}

export function crossfadeBuffers(
  outgoing: AudioBuffer,
  incoming: AudioBuffer,
  options: CrossfadeOptions = {},
): AudioBuffer {
  const sampleRate = outgoing.sampleRate;
  const channels = Math.max(outgoing.channels, incoming.channels);
  const overlapFrames = Math.max(
    0,
    Math.min(
      Math.round((options.overlapSeconds ?? 1) * sampleRate),
      outgoing.length,
      incoming.length,
    ),
  );
  const curve = options.curve ?? "equal-power";
  const totalFrames = outgoing.length + incoming.length - overlapFrames;
  const data = new Float32Array(totalFrames * channels);
  const incomingStart = outgoing.length - overlapFrames;

  for (let frame = 0; frame < outgoing.length; frame += 1) {
    const inOverlap = frame >= incomingStart;
    const progress = overlapFrames > 0 && inOverlap ? (frame - incomingStart) / overlapFrames : 0;
    const gains = crossfadeGains(curve, progress);
    for (let channel = 0; channel < channels; channel += 1) {
      data[frame * channels + channel] = readSample(outgoing, frame, channel) * gains.outgoing;
    }
  }

  for (let frame = 0; frame < incoming.length; frame += 1) {
    const target = incomingStart + frame;
    const inOverlap = frame < overlapFrames;
    const progress = overlapFrames > 0 && inOverlap ? frame / overlapFrames : 1;
    const gains = crossfadeGains(curve, progress);
    for (let channel = 0; channel < channels; channel += 1) {
      data[target * channels + channel] = (data[target * channels + channel] ?? 0)
        + readSample(incoming, frame, channel) * gains.incoming;
    }
  }

  return { sampleRate, channels, length: totalFrames, data };
}

export function applyFadeEnvelope(
  buffer: AudioBuffer,
  direction: "in" | "out",
  durationSeconds: number,
  curve: CrossfadeCurve = "equal-power",
): AudioBuffer {
  const frames = Math.max(0, Math.min(buffer.length, Math.round(durationSeconds * buffer.sampleRate)));
  if (frames === 0) return buffer;
  const data = new Float32Array(buffer.data);
  if (direction === "in") {
    for (let frame = 0; frame < frames; frame += 1) {
      const gain = crossfadeGains(curve, frame / frames).incoming;
      for (let channel = 0; channel < buffer.channels; channel += 1) {
        const index = frame * buffer.channels + channel;
        data[index] = (data[index] ?? 0) * gain;
      }
    }
  }
  if (direction === "out") {
    const start = buffer.length - frames;
    for (let frame = start; frame < buffer.length; frame += 1) {
      const progress = (frame - start) / frames;
      const gains = crossfadeGains(curve, 1 - progress);
      const gain = gains.outgoing;
      for (let channel = 0; channel < buffer.channels; channel += 1) {
        const index = frame * buffer.channels + channel;
        data[index] = (data[index] ?? 0) * gain;
      }
    }
  }
  return { ...buffer, data };
}
