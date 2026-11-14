const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

interface ValueState {
  readonly perm: Uint8Array;
  readonly values: Float32Array;
}

function buildState(seed: number): ValueState {
  const source = new Uint8Array(256);
  const lattice = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    source[i] = i;
  }
  let state = seed >>> 0 || 0x68e31da4;
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
  for (let i = 0; i < 256; i++) {
    lattice[i] = nextRandom();
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = source[i & 255]!;
  return { perm, values: lattice };
}

const DEFAULT_STATE = buildState(0);

function latticeValue(state: ValueState, i: number, j: number, k: number): number {
  return state.values[state.perm[state.perm[state.perm[i & 255]! + (j & 255)]! + (k & 255)]!]!;
}

export function value2(x: number, y: number): number {
  return value3(x, y, 0);
}

export function value3(x: number, y: number, z: number): number {
  const state = DEFAULT_STATE;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const c000 = latticeValue(state, xi, yi, zi);
  const c100 = latticeValue(state, xi + 1, yi, zi);
  const c010 = latticeValue(state, xi, yi + 1, zi);
  const c110 = latticeValue(state, xi + 1, yi + 1, zi);
  const c001 = latticeValue(state, xi, yi, zi + 1);
  const c101 = latticeValue(state, xi + 1, yi, zi + 1);
  const c011 = latticeValue(state, xi, yi + 1, zi + 1);
  const c111 = latticeValue(state, xi + 1, yi + 1, zi + 1);

  const x00 = lerp(c000, c100, u);
  const x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u);
  const x11 = lerp(c011, c111, u);
  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w) * 2 - 1;
}

export function createValue3(seed: number): (x: number, y: number, z: number) => number {
  const state = buildState(seed);
  const sample = (i: number, j: number, k: number): number => latticeValue(state, i, j, k);
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const x00 = lerp(sample(xi, yi, zi), sample(xi + 1, yi, zi), u);
    const x10 = lerp(sample(xi, yi + 1, zi), sample(xi + 1, yi + 1, zi), u);
    const x01 = lerp(sample(xi, yi, zi + 1), sample(xi + 1, yi, zi + 1), u);
    const x11 = lerp(sample(xi, yi + 1, zi + 1), sample(xi + 1, yi + 1, zi + 1), u);
    const y0 = lerp(x00, x10, v);
    const y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w) * 2 - 1;
  };
}
