export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface WarpCell {
  readonly col: number;
  readonly row: number;
  readonly srcPoints: readonly [Point, Point, Point, Point];
  readonly dstPoints: readonly [Point, Point, Point, Point];
}

export interface WarpGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly WarpCell[];
}

export function createWarpGrid(cols: number, rows: number, srcWidth: number, srcHeight: number): WarpGrid {
  const point = (col: number, row: number): Point => ({
    x: (col / cols) * srcWidth,
    y: (row / rows) * srcHeight,
  });
  const cells: WarpCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        col,
        row,
        srcPoints: [point(col, row), point(col + 1, row), point(col + 1, row + 1), point(col, row + 1)],
        dstPoints: [point(col, row), point(col + 1, row), point(col + 1, row + 1), point(col, row + 1)],
      });
    }
  }
  return { cols, rows, cells };
}

const CORNER_OFFSETS: readonly [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function applyWarpDisplacements(
  grid: WarpGrid,
  warpPoints: readonly { col: number; row: number; dx: number; dy: number }[],
): WarpGrid {
  const displacement = new Map<string, Point>();
  for (const warp of warpPoints) {
    displacement.set(`${warp.col},${warp.row}`, { x: warp.dx, y: warp.dy });
  }
  const cells = grid.cells.map((cell) => {
    const dstPoints = CORNER_OFFSETS.map(([dc, dr], index) => {
      const gridCol = cell.col + dc;
      const gridRow = cell.row + dr;
      const base = cell.srcPoints[index]!;
      const offset = displacement.get(`${gridCol},${gridRow}`);
      return offset ? { x: base.x + offset.x, y: base.y + offset.y } : base;
    }) as [Point, Point, Point, Point];
    return { ...cell, dstPoints };
  });
  return { ...grid, cells };
}

export function computeAnimatedWarp(
  time: number,
  cols: number,
  rows: number,
  srcWidth: number,
  srcHeight: number,
  intensity = 10,
  frequency = 2,
): WarpGrid {
  const grid = createWarpGrid(cols, rows, srcWidth, srcHeight);
  const cells = grid.cells.map((cell) => {
    const dstPoints = CORNER_OFFSETS.map(([dc, dr], index) => {
      const gridCol = cell.col + dc;
      const gridRow = cell.row + dr;
      const base = cell.srcPoints[index]!;
      if (gridCol === 0 || gridRow === 0 || gridCol === cols || gridRow === rows) return base;
      const phase = (gridCol / cols) * Math.PI * 2 + (gridRow / rows) * Math.PI * 2;
      return {
        x: base.x + Math.sin(time * frequency + phase) * intensity,
        y: base.y + Math.cos(time * frequency + phase * 0.5) * intensity,
      };
    }) as [Point, Point, Point, Point];
    return { ...cell, dstPoints };
  });
  return { ...grid, cells };
}
