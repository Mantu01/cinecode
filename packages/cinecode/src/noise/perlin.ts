const GRADIENTS_2D: readonly number[][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

const GRADIENTS_3D: readonly number[][] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const GRADIENTS_1D = [1, -1];

interface PerlinState {
  readonly perm: Uint8Array;
}

function buildPermutation(seed: number): PerlinState {
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  let state = seed >>> 0 || 0x2545f491;
  const nextRandom = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    const tmp = source[i]!;
    source[i] = source[j]!;
    source[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = source[i & 255]!;
  return { perm };
}

const DEFAULT_STATE = buildPermutation(0);

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

function grad2(hash: number, x: number, y: number): number {
  const g = GRADIENTS_2D[hash % GRADIENTS_2D.length]!;
  return g[0]! * x + g[1]! * y;
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const g = GRADIENTS_3D[hash % GRADIENTS_3D.length]!;
  return g[0]! * x + g[1]! * y + g[2]! * z;
}

export function perlin2(x: number, y: number): number {
  const { perm } = DEFAULT_STATE;
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[xi]! + yi]!;
  const ab = perm[perm[xi]! + yi + 1]!;
  const ba = perm[perm[xi + 1]! + yi]!;
  const bb = perm[perm[xi + 1]! + yi + 1]!;

  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

export function perlin3(x: number, y: number, z: number): number {
  const { perm } = DEFAULT_STATE;
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const aaa = perm[perm[perm[xi]! + yi]! + zi]!;
  const aba = perm[perm[perm[xi]! + yi + 1]! + zi]!;
  const aab = perm[perm[perm[xi]! + yi]! + zi + 1]!;
  const abb = perm[perm[perm[xi]! + yi + 1]! + zi + 1]!;
  const baa = perm[perm[perm[xi + 1]! + yi]! + zi]!;
  const bba = perm[perm[perm[xi + 1]! + yi + 1]! + zi]!;
  const bab = perm[perm[perm[xi + 1]! + yi]! + zi + 1]!;
  const bbb = perm[perm[perm[xi + 1]! + yi + 1]! + zi + 1]!;

  const x1 = lerp(grad3(aaa, xf, yf, zf), grad3(baa, xf - 1, yf, zf), u);
  const x2 = lerp(grad3(aba, xf, yf - 1, zf), grad3(bba, xf - 1, yf - 1, zf), u);
  const y1 = lerp(x1, x2, v);
  const x3 = lerp(grad3(aab, xf, yf, zf - 1), grad3(bab, xf - 1, yf, zf - 1), u);
  const x4 = lerp(grad3(abb, xf, yf - 1, zf - 1), grad3(bbb, xf - 1, yf - 1, zf - 1), u);
  const y2 = lerp(x3, x4, v);
  return lerp(y1, y2, w);
}

export function createPerlin3(seed: number): (x: number, y: number, z: number) => number {
  const state = buildPermutation(seed);
  const grad2Seeded = (hash: number, gx: number, gy: number): number => {
    const g = GRADIENTS_2D[hash % GRADIENTS_2D.length]!;
    return g[0]! * gx + g[1]! * gy;
  };
  const grad3Seeded = (hash: number, gx: number, gy: number, gz: number): number => {
    const g = GRADIENTS_3D[hash % GRADIENTS_3D.length]!;
    return g[0]! * gx + g[1]! * gy + g[2]! * gz;
  };
  const noise2 = (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = state.perm[state.perm[xi]! + yi]!;
    const ab = state.perm[state.perm[xi]! + yi + 1]!;
    const ba = state.perm[state.perm[xi + 1]! + yi]!;
    const bb = state.perm[state.perm[xi + 1]! + yi + 1]!;
    const x1 = lerp(grad2Seeded(aa, xf, yf), grad2Seeded(ba, xf - 1, yf), u);
    const x2 = lerp(grad2Seeded(ab, xf, yf - 1), grad2Seeded(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
  const noise3 = (x: number, y: number, z: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const aaa = state.perm[state.perm[state.perm[xi]! + yi]! + zi]!;
    const aba = state.perm[state.perm[state.perm[xi]! + yi + 1]! + zi]!;
    const aab = state.perm[state.perm[state.perm[xi]! + yi]! + zi + 1]!;
    const abb = state.perm[state.perm[state.perm[xi]! + yi + 1]! + zi + 1]!;
    const baa = state.perm[state.perm[state.perm[xi + 1]! + yi]! + zi]!;
    const bba = state.perm[state.perm[state.perm[xi + 1]! + yi + 1]! + zi]!;
    const bab = state.perm[state.perm[state.perm[xi + 1]! + yi]! + zi + 1]!;
    const bbb = state.perm[state.perm[state.perm[xi + 1]! + yi + 1]! + zi + 1]!;
    const x1 = lerp(grad3Seeded(aaa, xf, yf, zf), grad3Seeded(baa, xf - 1, yf, zf), u);
    const x2 = lerp(grad3Seeded(aba, xf, yf - 1, zf), grad3Seeded(bba, xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(grad3Seeded(aab, xf, yf, zf - 1), grad3Seeded(bab, xf - 1, yf, zf - 1), u);
    const x4 = lerp(grad3Seeded(abb, xf, yf - 1, zf - 1), grad3Seeded(bbb, xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w);
  };
  return noise3;
}

export const VALUE_NOISE_GRADIENTS_1D = GRADIENTS_1D;
