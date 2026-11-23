import type { Point } from "./shapes/index.js";

/**
 * Procedural geometry helpers. These are parameterized functions that return
 * point arrays, not visual presets — authors compose them with drawing verbs,
 * strokes, and fills. All helpers are pure and deterministic given their
 * parameters.
 */

/** Vertices of a regular polygon centered on (cx, cy). */
export function regularPolygon(cx: number, cy: number, radius: number, sides: number, rotation = 0): readonly Point[] {
  const count = Math.max(3, Math.floor(sides));
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rotation + (i / count) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

/** Star polygon with `points` spikes, alternating outer/inner radius. */
export function star(cx: number, cy: number, outerRadius: number, innerRadius: number, points: number, rotation = 0): readonly Point[] {
  const count = Math.max(3, Math.floor(points));
  const out: Point[] = [];
  for (let i = 0; i < count * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + (i / (count * 2)) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return out;
}

/** Points along a circular arc from startAngle to endAngle (radians). */
export function arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, segments = 32): readonly Point[] {
  const count = Math.max(2, Math.floor(segments));
  const points: Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / count;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

/** Closed ring (donut) outline as two concentric circles. */
export function ring(cx: number, cy: number, outerRadius: number, innerRadius: number, segments = 48): { readonly outer: readonly Point[]; readonly inner: readonly Point[] } {
  return {
    outer: arc(cx, cy, outerRadius, 0, Math.PI * 2, segments),
    inner: arc(cx, cy, innerRadius, 0, Math.PI * 2, segments),
  };
}

/** Archimedean spiral sampled from startRadius to endRadius over `turns`. */
export function spiral(cx: number, cy: number, startRadius: number, endRadius: number, turns: number, samplesPerTurn = 24): readonly Point[] {
  const totalTurns = Math.max(0.1, turns);
  const count = Math.max(2, Math.floor(totalTurns * Math.max(2, samplesPerTurn)));
  const points: Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = t * totalTurns * Math.PI * 2;
    const radius = startRadius + (endRadius - startRadius) * t;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

/** Grid/lattice of points spanning a rectangle, useful for lattices and wireframes. */
export function grid(x: number, y: number, width: number, height: number, columns: number, rows: number): readonly (readonly Point[])[] {
  const cols = Math.max(1, Math.floor(columns));
  const rws = Math.max(1, Math.floor(rows));
  const out: Point[][] = [];
  for (let row = 0; row <= rws; row += 1) {
    const line: Point[] = [];
    for (let col = 0; col <= cols; col += 1) {
      line.push({ x: x + (width * col) / cols, y: y + (height * row) / rws });
    }
    out.push(line);
  }
  return out;
}

/**
 * Morph a polygon per frame: interpolates between the base polygon radius and
 * a deterministic per-vertex wobble driven by a caller-supplied noise function.
 * This is an on-the-fly shape generation helper — geometry is computed from
 * time/seed/params each frame, keeping output reproducible.
 */
export function morphingPolygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  time: number,
  amplitude: number,
  noise: (value: number) => number,
  rotation = 0,
): readonly Point[] {
  const base = regularPolygon(cx, cy, radius, sides, rotation);
  return base.map((point, index) => {
    const wobble = noise(time + index * 1.618) * amplitude;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const scale = (length + wobble) / length;
    return { x: cx + dx * scale, y: cy + dy * scale };
  });
}

/** Convert a point list into a closed polygon command list for drawPath. */
export function pointsToClosedPath(points: readonly Point[]): readonly { command: "move" | "line" | "close"; points: readonly Point[] }[] {
  if (points.length === 0) return [];
  return [
    { command: "move", points: [points[0]!] },
    ...points.slice(1).map((point) => ({ command: "line" as const, points: [point] })),
    { command: "close", points: [] },
  ];
}
