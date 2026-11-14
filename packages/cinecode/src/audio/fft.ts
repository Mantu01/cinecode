export interface ComplexArray {
  readonly real: Float32Array;
  readonly imag: Float32Array;
}

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size <<= 1;
  return size;
}

function reverseBits(index: number, bits: number): number {
  let value = index;
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

export function fft(buffer: Float32Array): ComplexArray {
  const size = nextPowerOfTwo(buffer.length);
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  real.set(buffer);

  const bits = Math.log2(size) | 0;
  for (let i = 0; i < size; i++) {
    const target = reverseBits(i, bits);
    if (target > i) {
      const tmpReal = real[i]!;
      real[i] = real[target]!;
      real[target] = tmpReal;
      const tmpImag = imag[i]!;
      imag[i] = imag[target]!;
      imag[target] = tmpImag;
    }
  }

  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let curReal = 1;
      let curImag = 0;
      for (let offset = 0; offset < len / 2; offset++) {
        const even = start + offset;
        const odd = start + offset + len / 2;
        const oddReal = real[odd]! * curReal - imag[odd]! * curImag;
        const oddImag = real[odd]! * curImag + imag[odd]! * curReal;
        real[odd] = real[even]! - oddReal;
        imag[odd] = imag[even]! - oddImag;
        real[even] = real[even]! + oddReal;
        imag[even] = imag[even]! + oddImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
  return { real, imag };
}

export function magnitude(result: ComplexArray): Float32Array {
  const size = result.real.length;
  const output = new Float32Array(size / 2);
  for (let i = 0; i < output.length; i++) {
    output[i] = Math.hypot(result.real[i]!, result.imag[i]!);
  }
  return output;
}

export function extractBands(magnitudes: Float32Array, bandCount: number, sampleRate: number): Float32Array {
  const bands = new Float32Array(bandCount);
  const nyquist = sampleRate / 2;
  const spectrumSize = magnitudes.length;
  for (let band = 0; band < bandCount; band++) {
    const lowFreq = (band / bandCount) * nyquist;
    const highFreq = ((band + 1) / bandCount) * nyquist;
    const lowBin = Math.max(0, Math.floor((lowFreq / nyquist) * spectrumSize));
    const highBin = Math.min(spectrumSize, Math.ceil((highFreq / nyquist) * spectrumSize));
    let sum = 0;
    let count = 0;
    for (let bin = lowBin; bin < highBin; bin++) {
      sum += magnitudes[bin]!;
      count++;
    }
    bands[band] = count > 0 ? sum / count : 0;
  }
  return bands;
}

export function extractBandsLogarithmic(magnitudes: Float32Array, bandCount: number, sampleRate: number): Float32Array {
  const bands = new Float32Array(bandCount);
  const nyquist = sampleRate / 2;
  const spectrumSize = magnitudes.length;
  const minFreq = 20;
  for (let band = 0; band < bandCount; band++) {
    const lowFreq = minFreq * Math.pow(nyquist / minFreq, band / bandCount);
    const highFreq = minFreq * Math.pow(nyquist / minFreq, (band + 1) / bandCount);
    const lowBin = Math.max(0, Math.floor((lowFreq / nyquist) * spectrumSize));
    const highBin = Math.min(spectrumSize, Math.ceil((highFreq / nyquist) * spectrumSize));
    let peak = 0;
    for (let bin = lowBin; bin < highBin; bin++) {
      peak = Math.max(peak, magnitudes[bin]!);
    }
    bands[band] = peak;
  }
  return bands;
}
