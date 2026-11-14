const GRAD3: readonly number[][] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const F3 = 1 / 3;
const G3 = 1 / 6;

function buildPermutation(seed: number): Uint8Array {
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  let state = seed >>> 0 || 0x9e3779b9;
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
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = source[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }
  return perm;
}

interface SimplexState {
  readonly perm: Uint8Array;
  readonly permMod12: Uint8Array;
}

function createState(seed: number): SimplexState {
  const perm = buildPermutation(seed);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) permMod12[i] = perm[i]! % 12;
  return { perm, permMod12 };
}

const DEFAULT_STATE = createState(0);

function simplex3With(state: SimplexState, x: number, y: number, z: number): number {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);

  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
  }

  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;

  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  let n = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) {
    const gi0 = state.permMod12[ii + state.perm[jj + state.perm[kk]!]!]!;
    t0 *= t0;
    const g = GRAD3[gi0]!;
    n += t0 * t0 * (g[0]! * x0 + g[1]! * y0 + g[2]! * z0);
  }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) {
    const gi1 = state.permMod12[ii + i1 + state.perm[jj + j1 + state.perm[kk + k1]!]!]!;
    t1 *= t1;
    const g = GRAD3[gi1]!;
    n += t1 * t1 * (g[0]! * x1 + g[1]! * y1 + g[2]! * z1);
  }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) {
    const gi2 = state.permMod12[ii + i2 + state.perm[jj + j2 + state.perm[kk + k2]!]!]!;
    t2 *= t2;
    const g = GRAD3[gi2]!;
    n += t2 * t2 * (g[0]! * x2 + g[1]! * y2 + g[2]! * z2);
  }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) {
    const gi3 = state.permMod12[ii + 1 + state.perm[jj + 1 + state.perm[kk + 1]!]!]!;
    t3 *= t3;
    const g = GRAD3[gi3]!;
    n += t3 * t3 * (g[0]! * x3 + g[1]! * y3 + g[2]! * z3);
  }
  return 32 * n;
}

export function simplex3(x: number, y: number, z: number): number {
  return simplex3With(DEFAULT_STATE, x, y, z);
}

export function simplex2(x: number, y: number): number {
  return simplex3(x, y, 0);
}

export function createSimplex3(seed: number): (x: number, y: number, z: number) => number {
  const state = createState(seed);
  return (x: number, y: number, z: number) => simplex3With(state, x, y, z);
}
