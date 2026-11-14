import type { Point } from "./grid.js";

export type Homography = readonly number[];

export function projectiveTransform(srcPts: readonly Point[], dstPts: readonly Point[]): Homography {
  const matrix: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const [sx, sy] = [srcPts[i]!.x, srcPts[i]!.y];
    const [dx, dy] = [dstPts[i]!.x, dstPts[i]!.y];
    matrix.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
    matrix.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
  }
  return solveLinearSystem(matrix);
}

function solveLinearSystem(rows: readonly number[][]): Homography {
  const size = rows.length;
  const rhsIndex = size;
  const augmented = rows.map((row) => [...row]);
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![col]!) > Math.abs(augmented[pivot]![col]!)) pivot = row;
    }
    const pivotRow = augmented[pivot]!;
    if (Math.abs(pivotRow[col]!) < 1e-12) return identityHomography();
    augmented[pivot] = augmented[col]!;
    augmented[col] = pivotRow;
    const diagonal = augmented[col]![col]!;
    for (let j = 0; j <= rhsIndex; j += 1) augmented[col]![j]! /= diagonal;
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = augmented[row]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j <= rhsIndex; j += 1) {
        augmented[row]![j]! -= factor * augmented[col]![j]!;
      }
    }
  }
  return [...augmented.map((row) => row[rhsIndex]!), 1];
}

function identityHomography(): Homography {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function invertHomography(h: Homography): Homography {
  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = h;
  const determinant =
    h00! * (h11! * h22! - h12! * h21!) -
    h01! * (h10! * h22! - h12! * h20!) +
    h02! * (h10! * h21! - h11! * h20!);
  if (Math.abs(determinant) < 1e-12) return identityHomography();
  const inverse = 1 / determinant;
  return [
    (h11! * h22! - h12! * h21!) * inverse,
    (h02! * h21! - h01! * h22!) * inverse,
    (h01! * h12! - h02! * h11!) * inverse,
    (h12! * h20! - h10! * h22!) * inverse,
    (h00! * h22! - h02! * h20!) * inverse,
    (h02! * h10! - h00! * h12!) * inverse,
    (h10! * h21! - h11! * h20!) * inverse,
    (h01! * h20! - h00! * h21!) * inverse,
    (h00! * h11! - h01! * h10!) * inverse,
  ];
}

export function applyHomography(px: number, py: number, h: Homography): Point {
  const w = h[6]! * px + h[7]! * py + h[8]!;
  const denominator = w === 0 ? 1e-12 : w;
  return {
    x: (h[0]! * px + h[1]! * py + h[2]!) / denominator,
    y: (h[3]! * px + h[4]! * py + h[5]!) / denominator,
  };
}
