import { fft, type ComplexArray } from "../fft.js";

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size <<= 1;
  return size;
}

function inverseFft(spectrum: ComplexArray): Float32Array {
  const size = spectrum.real.length;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    real[i] = spectrum.real[i]!;
    imag[i] = -spectrum.imag[i]!;
  }
  const transformed = fftComplex({ real, imag });
  const output = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    output[i] = transformed.real[i]! / size;
  }
  return output;
}

function fftComplex(input: ComplexArray): ComplexArray {
  const size = input.real.length;
  const real = new Float32Array(input.real);
  const imag = new Float32Array(input.imag);
  const bits = Math.log2(size) | 0;
  for (let i = 0; i < size; i += 1) {
    const target = reverseBits(i, bits);
    if (target > i) {
      const tr = real[i]!;
      real[i] = real[target]!;
      real[target] = tr;
      const ti = imag[i]!;
      imag[i] = imag[target]!;
      imag[target] = ti;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let curReal = 1;
      let curImag = 0;
      for (let offset = 0; offset < len / 2; offset += 1) {
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

function reverseBits(index: number, bits: number): number {
  let value = index;
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

export function directConvolve(input: Float32Array, ir: Float32Array): Float32Array {
  const output = new Float32Array(input.length + ir.length - 1);
  for (let i = 0; i < input.length; i += 1) {
    const sample = input[i]!;
    if (sample === 0) continue;
    for (let j = 0; j < ir.length; j += 1) {
      output[i + j] = (output[i + j] ?? 0) + sample * ir[j]!;
    }
  }
  return output;
}

export function convolveOverlapAdd(
  input: Float32Array,
  ir: Float32Array,
  blockSize = 1024,
): Float32Array {
  if (input.length === 0 || ir.length === 0) return new Float32Array(Math.max(0, input.length));
  if (ir.length < 1024) return directConvolve(input, ir).subarray(0, input.length).slice();

  const fftSize = nextPowerOfTwo(blockSize + ir.length - 1);
  const irSpectrum = fftComplex({ real: pad(ir, fftSize), imag: new Float32Array(fftSize) });
  const output = new Float32Array(input.length + ir.length - 1);

  for (let start = 0; start < input.length; start += blockSize) {
    const block = pad(input.subarray(start, start + blockSize), fftSize);
    const blockSpectrum = fftComplex({ real: block, imag: new Float32Array(fftSize) });
    const product: ComplexArray = {
      real: new Float32Array(fftSize),
      imag: new Float32Array(fftSize),
    };
    for (let i = 0; i < fftSize; i += 1) {
      const ar = blockSpectrum.real[i]!;
      const ai = blockSpectrum.imag[i]!;
      const br = irSpectrum.real[i]!;
      const bi = irSpectrum.imag[i]!;
      product.real[i] = ar * br - ai * bi;
      product.imag[i] = ar * bi + ai * br;
    }
    const time = inverseFft(product);
    const offset = start;
    for (let i = 0; i < time.length && offset + i < output.length; i += 1) {
      output[offset + i] = (output[offset + i] ?? 0) + time[i]!;
    }
  }

  return output.subarray(0, input.length).slice();
}

function pad(source: ArrayLike<number>, size: number): Float32Array {
  const output = new Float32Array(size);
  for (let i = 0; i < source.length && i < size; i += 1) output[i] = source[i] ?? 0;
  return output;
}

export function convolveStereo(
  left: Float32Array,
  right: Float32Array,
  ir: Float32Array,
): { left: Float32Array; right: Float32Array } {
  return {
    left: convolveOverlapAdd(left, ir),
    right: convolveOverlapAdd(right, ir),
  };
}

export { fft };
