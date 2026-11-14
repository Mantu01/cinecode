import type { SoundDefinition, SoundRenderContext, NoteEvent, SoundNotePattern, OscillatorOptions, EnvelopeOptions, FilterOptions, LFOOptions, AudioBuffer } from "../types.js";
import { createOscillator } from "./oscillators.js";
import { createEnvelope } from "./envelope.js";
import { createFilter } from "./filters.js";
import { createLFO } from "./lfo.js";

export function createSilentBuffer(sampleRate: number, duration: number, channels: number = 2): AudioBuffer {
  const length = Math.ceil(duration * sampleRate);
  return {
    sampleRate,
    channels,
    length,
    data: new Float32Array(length * channels),
  };
}

export function createMonoBuffer(sampleRate: number, duration: number): AudioBuffer {
  const length = Math.ceil(duration * sampleRate);
  return {
    sampleRate,
    channels: 1,
    length,
    data: new Float32Array(length),
  };
}

export function stereoToMono(buffer: AudioBuffer): AudioBuffer {
  if (buffer.channels === 1) return buffer;
  const monoData = new Float32Array(buffer.length);
  const data = buffer.data;
  for (let i = 0; i < buffer.length; i++) {
    monoData[i] = (data[i * 2]! + data[i * 2 + 1]!) * 0.5;
  }
  return { ...buffer, channels: 1, data: monoData };
}

export function monoToStereo(buffer: AudioBuffer): AudioBuffer {
  if (buffer.channels === 2) return buffer;
  const stereoData = new Float32Array(buffer.length * 2);
  const data = buffer.data;
  for (let i = 0; i < buffer.length; i++) {
    const v = data[i]!;
    stereoData[i * 2] = v;
    stereoData[i * 2 + 1] = v;
  }
  return { ...buffer, channels: 2, data: stereoData };
}

function applyPan(buffer: AudioBuffer, pan: number): AudioBuffer {
  if (buffer.channels === 1) return monoToStereo(buffer);
  if (pan === 0) return buffer;
  const panL = Math.cos((pan + 1) * Math.PI / 4);
  const panR = Math.sin((pan + 1) * Math.PI / 4);
  const output = new Float32Array(buffer.data.length);
  const data = buffer.data;
  for (let i = 0; i < buffer.length; i++) {
    output[i * 2] = data[i * 2]! * panL;
    output[i * 2 + 1] = data[i * 2 + 1]! * panR;
  }
  return { ...buffer, data: output };
}

export function applyGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  const gain = Math.pow(10, gainDb / 20);
  const output = new Float32Array(buffer.data.length);
  const data = buffer.data;
  for (let i = 0; i < buffer.data.length; i++) {
    output[i] = data[i]! * gain;
  }
  return { ...buffer, data: output };
}

function applyFade(buffer: AudioBuffer, fadeIn: number, fadeOut: number): AudioBuffer {
  if (fadeIn <= 0 && fadeOut <= 0) return buffer;
  const output = new Float32Array(buffer.data.length);
  const data = buffer.data;
  const totalSamples = buffer.length;
  const fadeInSamples = Math.min(totalSamples, Math.ceil(fadeIn * buffer.sampleRate));
  const fadeOutSamples = Math.min(totalSamples, Math.ceil(fadeOut * buffer.sampleRate));

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
}

function applyTrim(buffer: AudioBuffer, trimStart: number, trimEnd: number): AudioBuffer {
  const startSample = Math.floor(trimStart * buffer.sampleRate);
  const endSample = buffer.length - Math.floor(trimEnd * buffer.sampleRate);
  if (startSample <= 0 && endSample >= buffer.length) return buffer;
  const newLength = Math.max(0, endSample - startSample);
  const output = new Float32Array(newLength * buffer.channels);
  const data = buffer.data;
  for (let i = 0; i < newLength; i++) {
    for (let c = 0; c < buffer.channels; c++) {
      output[i * buffer.channels + c] = data[(startSample + i) * buffer.channels + c]!;
    }
  }
  return { ...buffer, length: newLength, data: output };
}

function applySpeed(buffer: AudioBuffer, speed: number, reverse: boolean): AudioBuffer {
  if (speed === 1 && !reverse) return buffer;
  if (speed === 0) return createSilentBuffer(buffer.sampleRate, 0, buffer.channels);
  const newLength = Math.ceil(buffer.length / Math.abs(speed));
  const output = new Float32Array(newLength * buffer.channels);
  const data = buffer.data;
  const step = 1 / Math.abs(speed);
  
  for (let i = 0; i < newLength; i++) {
    const sourceIndex = reverse 
      ? buffer.length - 1 - Math.floor(i * step)
      : Math.floor(i * step);
    const clampedIndex = Math.max(0, Math.min(buffer.length - 1, sourceIndex));
    for (let c = 0; c < buffer.channels; c++) {
      output[i * buffer.channels + c] = data[clampedIndex * buffer.channels + c]!;
    }
  }
  return { ...buffer, length: newLength, data: output };
}

export interface SynthVoice {
  oscillators: ReturnType<typeof createOscillator>[];
  envelope: ReturnType<typeof createEnvelope>;
  filter?: ReturnType<typeof createFilter>;
  lfo?: ReturnType<typeof createLFO>;
}

export function createSynthVoice(
  context: SoundRenderContext,
  oscillators: OscillatorOptions[],
  envelope: EnvelopeOptions,
  filter?: FilterOptions,
  lfo?: LFOOptions
): SynthVoice {
  const { sampleRate, rng } = context;
  return {
    oscillators: oscillators.map(o => createOscillator(o, rng)),
    envelope: createEnvelope(envelope),
    filter: filter ? createFilter(filter, sampleRate) : undefined,
    lfo: lfo ? createLFO(lfo, sampleRate, rng) : undefined,
  };
}

export function renderSynthVoice(
  voice: SynthVoice,
  context: SoundRenderContext,
  note: NoteEvent,
  outputBuffer: AudioBuffer,
  startSample: number
): void {
  const { sampleRate } = context;
  const noteStartSample = Math.floor(note.start * sampleRate);
  const noteEndSample = Math.floor((note.start + note.length) * sampleRate);
  const renderStart = Math.max(startSample, noteStartSample);
  const renderEnd = Math.min(startSample + outputBuffer.length, noteEndSample);
  
  if (renderStart >= renderEnd) return;

  const renderLength = renderEnd - renderStart;
  const monoBuffer = createMonoBuffer(sampleRate, renderLength / sampleRate);
  const envelopeBuffer = new Float32Array(renderLength);
  let filterBuffer: Float32Array | undefined;
  let lfoBuffer: Float32Array | undefined;

  for (const osc of voice.oscillators) {
    osc(renderLength, sampleRate, monoBuffer.data, 0);
  }

  voice.envelope.process(renderLength, sampleRate, true, envelopeBuffer, 0);

  for (let i = 0; i < renderLength; i++) {
    monoBuffer.data[i]! *= envelopeBuffer[i]!;
  }

  if (voice.filter) {
    filterBuffer = new Float32Array(renderLength);
    voice.filter.process(monoBuffer.data, filterBuffer, 0, renderLength);
    monoBuffer.data.set(filterBuffer);
  }

  if (voice.lfo) {
    lfoBuffer = new Float32Array(renderLength);
    voice.lfo.process(renderLength, lfoBuffer, 0);
    for (let i = 0; i < renderLength; i++) {
      monoBuffer.data[i]! *= (1 + lfoBuffer[i]!);
    }
  }

  const stereoBuffer = monoToStereo(monoBuffer);
  const velocity = note.velocity ?? 1;
  
  for (let i = 0; i < renderLength; i++) {
    const outIdx = (renderStart - startSample + i) * 2;
    if (outIdx + 1 < outputBuffer.data.length) {
      outputBuffer.data[outIdx]! += stereoBuffer.data[i * 2]! * velocity;
      outputBuffer.data[outIdx + 1]! += stereoBuffer.data[i * 2 + 1]! * velocity;
    }
  }
}

export function renderSound(
  definition: SoundDefinition,
  context: SoundRenderContext
): AudioBuffer {
  const { sampleRate, duration } = context;
  const outputBuffer = createSilentBuffer(sampleRate, duration, 2);
  
  const pattern = (definition as unknown as { pattern: SoundNotePattern }).pattern;
  if (!pattern) return outputBuffer;

  const voice = createSynthVoice(
    context,
    [...pattern.oscillators],
    pattern.envelope,
    pattern.filter,
    pattern.lfo
  );

  for (const note of pattern.notes) {
    renderSynthVoice(voice, context, note, outputBuffer, 0);
  }

  return outputBuffer;
}

export function applyClipProcessing(
  buffer: AudioBuffer,
  trimStart: number,
  trimEnd: number,
  speed: number,
  reverse: boolean,
  volume: number,
  fadeIn: number,
  fadeOut: number,
  pan: number,
  muted: boolean
): AudioBuffer {
  if (muted) return createSilentBuffer(buffer.sampleRate, 0, buffer.channels);
  
  let result = buffer;
  result = applyTrim(result, trimStart, trimEnd);
  result = applySpeed(result, speed, reverse);
  result = applyGain(result, volume);
  result = applyFade(result, fadeIn, fadeOut);
  result = applyPan(result, pan);
  return result;
}

export function mixBuffers(buffers: AudioBuffer[], masterVolume: number = 1): AudioBuffer {
  if (buffers.length === 0) {
    return createSilentBuffer(48000, 0, 2);
  }
  if (buffers.length === 1) {
    const buf = buffers[0]!;
    if (masterVolume !== 1) {
      return applyGain(buf, 20 * Math.log10(masterVolume));
    }
    return buf;
  }

  const sampleRate = buffers[0]!.sampleRate;
  const maxLength = Math.max(...buffers.map(b => b.length));
  const output = createSilentBuffer(sampleRate, maxLength / sampleRate, 2);

  for (const buf of buffers) {
    const minLength = Math.min(output.length, buf.length);
    const bufData = buf.data;
    for (let i = 0; i < minLength; i++) {
      for (let c = 0; c < 2; c++) {
        const bufChannel = buf.channels === 1 ? 0 : c;
        output.data[i * 2 + c]! += bufData[i * buf.channels + bufChannel]!;
      }
    }
  }

  if (masterVolume !== 1) {
    return applyGain(output, 20 * Math.log10(masterVolume));
  }

  return output;
}