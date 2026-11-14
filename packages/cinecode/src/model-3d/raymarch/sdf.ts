export type Vec3 = [number, number, number];

export function vec3Length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sdSphere(p: Vec3, radius: number): number {
  return vec3Length(p) - radius;
}

export function sdBox(p: Vec3, b: Vec3): number {
  const q: Vec3 = [
    Math.abs(p[0]) - b[0],
    Math.abs(p[1]) - b[1],
    Math.abs(p[2]) - b[2],
  ];
  const qOutside: Vec3 = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)];
  return (
    vec3Length(qOutside) +
    Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0)
  );
}

export function sdRoundCylinder(p: Vec3, ra: number, rb: number, h: number): number {
  const dX = Math.hypot(p[0], p[2]) - 2.0 * ra + rb;
  const dY = Math.abs(p[1]) - h;
  return (
    Math.min(Math.max(dX, dY), 0.0) +
    Math.hypot(Math.max(dX, 0.0), Math.max(dY, 0.0)) -
    rb
  );
}

export function sdTorus(p: Vec3, t: [number, number]): number {
  const qX = Math.hypot(p[0], p[2]) - t[0];
  return Math.hypot(qX, p[1]) - t[1];
}

export function sdCone(p: Vec3, c: [number, number], h: number): number {
  const q = Math.hypot(p[0], p[2]);
  return Math.max(c[0] * q + c[1] * p[1], -h - p[1]);
}

export function sdPlane(p: Vec3, n: Vec3, h: number): number {
  return p[0] * n[0] + p[1] * n[1] + p[2] * n[2] + h;
}

export function sdMandelbulb(p: Vec3, power = 8, maxIterations = 8): number {
  let w: Vec3 = [p[0], p[1], p[2]];
  let m = vec3Length(w);
  let dz = 1.0;

  for (let i = 0; i < maxIterations; i++) {
    dz = power * Math.pow(m, power - 1.0) * dz + 1.0;

    let r = vec3Length(w);
    if (r > 2.0) break;

    let theta = Math.acos(Math.max(-1, Math.min(1, w[1] / (r || 1e-6))));
    let phi = Math.atan2(w[2], w[0]);

    theta *= power;
    phi *= power;

    const zr = Math.pow(r, power);
    w = [
      zr * Math.sin(theta) * Math.cos(phi) + p[0],
      zr * Math.cos(theta) + p[1],
      zr * Math.sin(theta) * Math.sin(phi) + p[2],
    ];

    m = vec3Length(w);
  }

  return 0.5 * Math.log(m) * m / dz;
}

export function sdJulia3D(
  p: Vec3,
  c: [number, number, number, number] = [-0.2, 0.6, 0.2, 0.0],
  iterations = 10,
): number {
  let z: [number, number, number, number] = [p[0], p[1], p[2], 0];
  let md2 = 1.0;
  let mz2 = z[0] * z[0] + z[1] * z[1] + z[2] * z[2] + z[3] * z[3];

  for (let n = 0; n < iterations; n++) {
    md2 *= 4.0 * mz2;
    z = [
      z[0] * z[0] - z[1] * z[1] - z[2] * z[2] - z[3] * z[3] + c[0],
      2.0 * z[0] * z[1] + c[1],
      2.0 * z[0] * z[2] + c[2],
      2.0 * z[0] * z[3] + c[3],
    ];
    mz2 = z[0] * z[0] + z[1] * z[1] + z[2] * z[2] + z[3] * z[3];
    if (mz2 > 4.0) break;
  }

  return 0.25 * Math.sqrt(mz2 / md2) * Math.log(mz2);
}

export function sdMengerSponge(p: Vec3, iterations = 4): number {
  let d = sdBox(p, [1, 1, 1]);
  let s = 1.0;

  let x = p[0];
  let y = p[1];
  let z = p[2];

  for (let m = 0; m < iterations; m++) {
    const a = (x * s) % 2.0 - 1.0;
    const b = (y * s) % 2.0 - 1.0;
    const c = (z * s) % 2.0 - 1.0;

    s *= 3.0;
    const r: Vec3 = [
      1.0 - 3.0 * Math.abs(a),
      1.0 - 3.0 * Math.abs(b),
      1.0 - 3.0 * Math.abs(c),
    ];

    const da = Math.max(r[0], r[1]);
    const db = Math.max(r[1], r[2]);
    const dc = Math.max(r[2], r[0]);
    const cVal = (Math.min(da, Math.min(db, dc)) - 1.0) / s;

    d = Math.max(d, cVal);
  }

  return d;
}

export interface MetaballSpec {
  center: Vec3;
  radius: number;
}

export function sdMetaballs(p: Vec3, balls: MetaballSpec[], k = 0.2): number {
  if (balls.length === 0 || !balls[0]) return 1e6;
  let d = sdSphere(vec3Sub(p, balls[0].center), balls[0].radius);
  for (let i = 1; i < balls.length; i++) {
    const ball = balls[i];
    if (!ball) continue;
    const d2 = sdSphere(vec3Sub(p, ball.center), ball.radius);
    d = opSmoothUnion(d, d2, k);
  }
  return d;
}

export function opUnion(d1: number, d2: number): number {
  return Math.min(d1, d2);
}

export function opIntersection(d1: number, d2: number): number {
  return Math.max(d1, d2);
}

export function opSubtraction(d1: number, d2: number): number {
  return Math.max(-d1, d2);
}

export function opSmoothUnion(d1: number, d2: number, k = 0.2): number {
  const h = Math.max(k - Math.abs(d1 - d2), 0.0) / (k || 1e-6);
  return Math.min(d1, d2) - h * h * k * 0.25;
}

export function opSmoothSubtraction(d1: number, d2: number, k = 0.2): number {
  const h = Math.max(k - Math.abs(-d1 - d2), 0.0) / (k || 1e-6);
  return Math.max(-d1, d2) + h * h * k * 0.25;
}

export function opSmoothIntersection(d1: number, d2: number, k = 0.2): number {
  const h = Math.max(k - Math.abs(d1 - d2), 0.0) / (k || 1e-6);
  return Math.max(d1, d2) + h * h * k * 0.25;
}

export function opRepetition(p: Vec3, c: Vec3): Vec3 {
  return [
    ((p[0] % c[0]) + c[0]) % c[0] - 0.5 * c[0],
    ((p[1] % c[1]) + c[1]) % c[1] - 0.5 * c[1],
    ((p[2] % c[2]) + c[2]) % c[2] - 0.5 * c[2],
  ];
}

export function opLimitedRepetition(p: Vec3, s: number, l: Vec3): Vec3 {
  return [
    p[0] - s * Math.max(-l[0], Math.min(l[0], Math.round(p[0] / s))),
    p[1] - s * Math.max(-l[1], Math.min(l[1], Math.round(p[1] / s))),
    p[2] - s * Math.max(-l[2], Math.min(l[2], Math.round(p[2] / s))),
  ];
}
