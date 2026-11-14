export interface Rational {
  readonly num: number;
  readonly den: number;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export function rational(num: number, den: number): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new RangeError(`rational requires whole numbers: ${num}/${den}`);
  }
  if (den === 0) {
    throw new RangeError("rational denominator is zero");
  }
  const sign = den < 0 ? -1 : 1;
  const n = num * sign;
  const d = Math.abs(den);
  const g = gcd(n, d) || 1;
  return { num: n / g, den: d / g };
}

export function rationalAdd(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function rationalSub(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function rationalMul(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}

export function rationalDiv(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den, a.den * b.num);
}

export function rationalEquals(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

const BROADCAST_FPS: ReadonlyMap<string, Rational> = new Map([
  ["23.976", { num: 24000, den: 1001 }],
  ["29.97", { num: 30000, den: 1001 }],
  ["59.94", { num: 60000, den: 1001 }],
]);

export function resolveFps(value: number | Rational): Rational {
  if (typeof value !== "number") {
    return value;
  }
  const found = BROADCAST_FPS.get(String(value));
  if (found) {
    return found;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`fps must be a whole number from 1 to 120 or a broadcast rate (23.976, 29.97, 59.94), got ${value}`);
  }
  return { num: value, den: 1 };
}
