import type { ColorPaletteName } from "./types.js";

type Rgb = [number, number, number];

const VIRIDIS_STOPS: [number, Rgb][] = [
  [0.0, [68, 1, 84]],
  [0.15, [72, 40, 120]],
  [0.25, [62, 74, 137]],
  [0.4, [49, 104, 142]],
  [0.55, [38, 130, 142]],
  [0.7, [53, 183, 121]],
  [0.85, [109, 205, 89]],
  [1.0, [253, 231, 37]],
];

const PLASMA_STOPS: [number, Rgb][] = [
  [0.0, [13, 8, 135]],
  [0.2, [84, 2, 163]],
  [0.4, [156, 23, 158]],
  [0.6, [203, 70, 121]],
  [0.8, [240, 130, 75]],
  [1.0, [240, 249, 33]],
];

const INFERNO_STOPS: [number, Rgb][] = [
  [0.0, [0, 0, 4]],
  [0.2, [40, 11, 84]],
  [0.4, [101, 21, 110]],
  [0.6, [159, 42, 99]],
  [0.8, [212, 72, 66]],
  [0.95, [245, 125, 21]],
  [1.0, [252, 255, 164]],
];

const COOLWARM_STOPS: [number, Rgb][] = [
  [0.0, [59, 76, 192]],
  [0.25, [124, 159, 247]],
  [0.5, [221, 221, 221]],
  [0.75, [244, 154, 123]],
  [1.0, [180, 4, 38]],
];

function sampleStops(stops: [number, Rgb][], t: number): Rgb {
  if (stops.length === 0 || !stops[0]) return [0, 0, 0];
  const first = stops[0];
  const last = stops[stops.length - 1] ?? first;
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= first[0]) return first[1];
  if (clamped >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (!s0 || !s1) continue;
    const [t0, c0] = s0;
    const [t1, c1] = s1;
    if (clamped >= t0 && clamped <= t1) {
      const f = (clamped - t0) / (t1 - t0 || 1);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return last[1];
}

function turboPalette(t: number): Rgb {
  const x = Math.max(0, Math.min(1, t));
  const r = 34.61 + x * (1172.42 + x * (-1079.01 + x * (-3304.71 + x * (7926.82 + x * -4481.36))));
  const g = 23.31 + x * (557.33 + x * (1225.33 + x * (-3574.96 + x * (1073.77 + x * 707.56))));
  const b = 27.2 + x * (3211.1 - x * (15327.97 - x * (27814.0 - x * (22569.18 - x * 6838.79))));
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

export function samplePalette(palette: ColorPaletteName, t: number): Rgb {
  switch (palette) {
    case "viridis":
      return sampleStops(VIRIDIS_STOPS, t);
    case "plasma":
      return sampleStops(PLASMA_STOPS, t);
    case "inferno":
      return sampleStops(INFERNO_STOPS, t);
    case "coolwarm":
      return sampleStops(COOLWARM_STOPS, t);
    case "turbo":
      return turboPalette(t);
    default:
      return sampleStops(VIRIDIS_STOPS, t);
  }
}
