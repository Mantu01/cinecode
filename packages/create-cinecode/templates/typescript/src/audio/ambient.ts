import { defineAudio } from "cinecode";

/**
 * Fully procedural audio — synthesized into an `AudioBuffer` and written to
 * `output/audio/<id>.wav` by `cinecode generate audio`.
 */
export default defineAudio(({ sampleRate, channels, duration, gain }) => {
  const length = Math.max(1, Math.round(sampleRate * duration));
  const data = new Float32Array(length * channels);
  const notes = [220, 277.18, 329.63, 440];

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.8);
    const release = Math.min(1, (duration - t) / 1.2);
    const envelope = Math.max(0, Math.min(attack, release));
    const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.15 * t);

    let sample = 0;
    for (const frequency of notes) {
      sample += Math.sin(2 * Math.PI * frequency * t) / notes.length;
    }

    const value = sample * envelope * lfo * gain;
    data[i * channels] = value;
    if (channels > 1) data[i * channels + 1] = value * 0.96;
  }

  return { sampleRate, channels, length, data };
});
