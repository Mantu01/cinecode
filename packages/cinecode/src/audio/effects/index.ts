import type { AudioBuffer } from "../types.js";
import { deriveSeed, random } from "../../core/random/index.js";

export function createGainEffect(gainDb: number): (buffer: AudioBuffer) => AudioBuffer {
  const gain = Math.pow(10, gainDb / 20);
  return (buffer: AudioBuffer): AudioBuffer => {
    const data = buffer.data;
    const output = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      output[i] = data[i]! * gain;
    }
    return { ...buffer, data: output };
  };
}

export function createPanEffect(pan: number): (buffer: AudioBuffer) => AudioBuffer {
  if (pan === 0) return (b) => b;
  return (buffer: AudioBuffer): AudioBuffer => {
    if (buffer.channels === 1) {
      const stereo = new Float32Array(buffer.length * 2);
      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);
      const data = buffer.data;
      for (let i = 0; i < buffer.length; i++) {
        stereo[i * 2] = data[i]! * panL;
        stereo[i * 2 + 1] = data[i]! * panR;
      }
      return { ...buffer, channels: 2, data: stereo };
    }
    const output = new Float32Array(buffer.data.length);
    const panL = Math.cos((pan + 1) * Math.PI / 4);
    const panR = Math.sin((pan + 1) * Math.PI / 4);
    const data = buffer.data;
    for (let i = 0; i < buffer.length; i++) {
      output[i * 2] = data[i * 2]! * panL;
      output[i * 2 + 1] = data[i * 2 + 1]! * panR;
    }
    return { ...buffer, data: output };
  };
}

export function createDelayEffect(
  delayTime: number,
  feedback: number,
  wetDryMix: number,
  sampleRate: number
): (buffer: AudioBuffer) => AudioBuffer {
  const delaySamples = Math.floor(delayTime * sampleRate);
  return (buffer: AudioBuffer): AudioBuffer => {
    const data = buffer.data;
    const output = new Float32Array(data.length);
    const delayBuffer = new Float32Array(delaySamples * buffer.channels).fill(0);
    let delayIndex = 0;

    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < buffer.channels; c++) {
        const input = data[i * buffer.channels + c]!;
        const delayed = delayBuffer[delayIndex * buffer.channels + c]!;
        output[i * buffer.channels + c] = input * (1 - wetDryMix) + delayed * wetDryMix;
        delayBuffer[delayIndex * buffer.channels + c] = input + delayed * feedback;
      }
      delayIndex = (delayIndex + 1) % delaySamples;
    }
    return { ...buffer, data: output };
  };
}

function createReverbImpulseResponse(roomSize: number, damping: number, sampleRate: number, seed: number): Float32Array {
  const length = Math.floor(sampleRate * roomSize * 2);
  const impulse = new Float32Array(length);
  const decay = Math.exp(-3 / (roomSize * sampleRate));
  const rng = random(seed);
  let value = 1;

  for (let i = 0; i < length; i++) {
    const noise = (rng.next() * 2 - 1) * Math.pow(decay, i / sampleRate);
    impulse[i] = noise * value;
    value *= Math.pow(damping, 1 / sampleRate);
  }
  return impulse;
}

export function createReverbEffect(
  roomSize: number,
  damping: number,
  wetDryMix: number,
  sampleRate: number,
  seed: number = 42
): (buffer: AudioBuffer) => AudioBuffer {
  const impulseL = createReverbImpulseResponse(roomSize, damping, sampleRate, deriveSeed(seed, ["reverb", "left"]));
  const impulseR = createReverbImpulseResponse(roomSize * 0.97, damping * 1.03, sampleRate, deriveSeed(seed, ["reverb", "right"]));
  const impulseLength = impulseL.length;

  return (buffer: AudioBuffer): AudioBuffer => {
    const outputLength = buffer.length + impulseLength - 1;
    const output = new Float32Array(outputLength * 2);
    const inputL = buffer.channels === 1 ? buffer.data : new Float32Array(buffer.length);
    const inputR = buffer.channels === 1 ? buffer.data : new Float32Array(buffer.length);
    const data = buffer.data;

    if (buffer.channels === 2) {
      for (let i = 0; i < buffer.length; i++) {
        inputL[i] = data[i * 2]!;
        inputR[i] = data[i * 2 + 1]!;
      }
    }

    for (let i = 0; i < buffer.length; i++) {
      for (let j = 0; j < impulseLength && i + j < outputLength; j++) {
        output[(i + j) * 2]! += inputL[i]! * impulseL[j]! * wetDryMix;
        output[(i + j) * 2 + 1]! += inputR[i]! * impulseR[j]! * wetDryMix;
      }
    }

    for (let i = 0; i < buffer.length; i++) {
      output[i * 2]! += inputL[i]! * (1 - wetDryMix);
      output[i * 2 + 1]! += inputR[i]! * (1 - wetDryMix);
    }

    return { ...buffer, length: outputLength, data: output.slice(0, buffer.length * 2) };
  };
}

export function createFadeEffect(fadeIn: number, fadeOut: number, sampleRate: number): (buffer: AudioBuffer) => AudioBuffer {
  return (buffer: AudioBuffer): AudioBuffer => {
    if (fadeIn <= 0 && fadeOut <= 0) return buffer;
    const data = buffer.data;
    const output = new Float32Array(data.length);
    const totalSamples = buffer.length;
    const fadeInSamples = Math.min(totalSamples, Math.ceil(fadeIn * sampleRate));
    const fadeOutSamples = Math.min(totalSamples, Math.ceil(fadeOut * sampleRate));

    for (let i = 0; i < totalSamples; i++) {
      let gain = 1;
      if (i < fadeInSamples) {
        gain = i / fadeInSamples;
      } else if (i >= totalSamples - fadeOutSamples) {
        gain = (totalSamples - i) / fadeOutSamples;
      }
      for (let c = 0; c < buffer.channels; c++) {
        output[i * buffer.channels + c] = data[i * buffer.channels + c]! * gain;
      }
    }
    return { ...buffer, data: output };
  };
}

export function createSaturationEffect(drive: number): (buffer: AudioBuffer) => AudioBuffer {
  return (buffer: AudioBuffer): AudioBuffer => {
    const data = buffer.data;
    const output = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const x = data[i]! * drive;
      output[i] = Math.tanh(x) / Math.tanh(drive);
    }
    return { ...buffer, data: output };
  };
}