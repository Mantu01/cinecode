export type Hsv = readonly [hue: number, saturation: number, value: number];

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === rn) {
      hue = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      hue = (bn - rn) / delta + 2;
    } else {
      hue = (rn - gn) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = max === 0 ? 0 : delta / max;
  return [hue, saturation, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hue < 60) {
    rn = c; gn = x;
  } else if (hue < 120) {
    rn = x; gn = c;
  } else if (hue < 180) {
    gn = c; bn = x;
  } else if (hue < 240) {
    gn = x; bn = c;
  } else if (hue < 300) {
    rn = x; bn = c;
  } else {
    rn = c; bn = x;
  }
  return [Math.round((rn + m) * 255), Math.round((gn + m) * 255), Math.round((bn + m) * 255)];
}

export function hueDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

export function colorDistanceHsv(a: Hsv, b: Hsv): number {
  const hueWeight = 0.6;
  const satWeight = 0.25;
  const valWeight = 0.15;
  const hueDelta = hueDifference(a[0], b[0]) / 180;
  const satDelta = Math.abs(a[1] - b[1]);
  const valDelta = Math.abs(a[2] - b[2]);
  return hueWeight * hueDelta + satWeight * satDelta + valWeight * valDelta;
}
