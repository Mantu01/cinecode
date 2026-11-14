import { createCanvas } from "@napi-rs/canvas";

export interface Text3dStyle {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly fontWeight?: number | string;
  readonly fontStyle?: string;
  readonly letterSpacing?: number;
}

export interface MeshData {
  readonly vertices: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly frontFaceIndices: Uint32Array;
  readonly backFaceIndices: Uint32Array;
  readonly sideWallIndices: Uint32Array;
  readonly width: number;
  readonly height: number;
}

export interface ExtrudeOptions {
  readonly depth?: number;
  readonly bevel?: boolean;
  readonly bevelDepth?: number;
  readonly cellSize?: number;
  readonly maxWidth?: number;
}

const MESH_CACHE_MAX = 64;
const meshCache = new Map<string, MeshData>();

interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly alpha: Uint8Array;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

function rasterize(text: string, style: Text3dStyle, maxWidth: number): Grid {
  const fontSize = Math.max(8, style.fontSize);
  const weight = style.fontWeight ?? 700;
  const font = `${style.fontStyle ?? "normal"} ${weight} ${fontSize}px ${style.fontFamily ?? "sans-serif"}`;
  const measureCanvas = createCanvas(8, 8);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = font;
  const spacing = style.letterSpacing ?? 0;
  const letterWidths = [...text].map((char) => measureCtx.measureText(char).width + spacing);
  const totalWidth = Math.max(fontSize, letterWidths.reduce((sum, width) => sum + width, 0));
  const canvasWidth = Math.max(1, Math.min(maxWidth, Math.ceil(totalWidth + fontSize * 0.4)));
  const canvasHeight = Math.max(1, Math.ceil(fontSize * 1.5));

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const image = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const cell = Math.max(1, Math.round(style.fontSize && fontSize > 80 ? 3 : 2));
  const cols = Math.max(1, Math.floor(canvasWidth / cell));
  const rows = Math.max(1, Math.floor(canvasHeight / cell));
  const alpha = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = Math.min(canvasWidth - 1, col * cell + Math.floor(cell / 2));
      const y = Math.min(canvasHeight - 1, row * cell + Math.floor(cell / 2));
      const index = (y * canvasWidth + x) * 4 + 3;
      alpha[row * cols + col] = (image.data[index] ?? 0) > 110 ? 1 : 0;
    }
  }
  return { cols, rows, cell, alpha, canvasWidth, canvasHeight };
}

export function extrudeTextGeometry(
  text: string,
  style: Text3dStyle,
  options: ExtrudeOptions = {},
): MeshData {
  const depth = Math.max(0.5, options.depth ?? 20);
  const maxWidth = options.maxWidth ?? 2048;
  const key = `${text}|${style.fontFamily ?? ""}|${style.fontSize}|${style.fontWeight ?? ""}|${depth}|${options.bevel ?? false}|${maxWidth}`;
  const cached = meshCache.get(key);
  if (cached) return cached;

  const grid = rasterize(text, style, maxWidth);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const frontIndices: number[] = [];
  const backIndices: number[] = [];
  const sideIndices: number[] = [];

  const addVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number => {
    const index = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return index;
  };

  const cellOf = (col: number, row: number): number => {
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 0;
    return grid.alpha[row * grid.cols + col] ?? 0;
  };

  const scaleX = grid.cell;
  const bevelOffset = options.bevel === true ? Math.max(1, (options.bevelDepth ?? 2)) : 0;

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (cellOf(col, row) === 0) continue;
      const x0 = col * scaleX;
      const y0 = row * scaleX;
      const x1 = x0 + scaleX;
      const y1 = y0 + scaleX;
      const u0 = col / grid.cols;
      const u1 = (col + 1) / grid.cols;
      const v0 = row / grid.rows;
      const v1 = (row + 1) / grid.rows;

      const frontZ = -bevelOffset;
      const backZ = depth;
      const front = [
        addVertex(x0, y0, frontZ, 0, 0, -1, u0, v0),
        addVertex(x1, y0, frontZ, 0, 0, -1, u1, v0),
        addVertex(x1, y1, frontZ, 0, 0, -1, u1, v1),
        addVertex(x0, y1, frontZ, 0, 0, -1, u0, v1),
      ];
      const back = [
        addVertex(x0, y0, backZ, 0, 0, 1, u0, v0),
        addVertex(x1, y0, backZ, 0, 0, 1, u1, v0),
        addVertex(x1, y1, backZ, 0, 0, 1, u1, v1),
        addVertex(x0, y1, backZ, 0, 0, 1, u0, v1),
      ];
      pushQuad(front, [0, 1, 2, 3], indices, frontIndices);
      pushQuad(back, [3, 2, 1, 0], indices, backIndices);

      const walls: readonly [number, number, number, number, number, number, readonly [number, number, number]][] = [
        [col - 1, row, x0, y0, x0, y1, [-1, 0, 0]],
        [col + 1, row, x1, y0, x1, y1, [1, 0, 0]],
        [col, row - 1, x0, y0, x1, y0, [0, -1, 0]],
        [col, row + 1, x0, y1, x1, y1, [0, 1, 0]],
      ];
      for (const [neighborCol, neighborRow, ax, ay, bx, by, normal] of walls) {
        if (cellOf(neighborCol, neighborRow) !== 0) continue;
        const wall = [
          addVertex(ax, ay, frontZ, normal[0], normal[1], normal[2], 0, 0),
          addVertex(bx, by, frontZ, normal[0], normal[1], normal[2], 1, 0),
          addVertex(bx, by, backZ, normal[0], normal[1], normal[2], 1, 1),
          addVertex(ax, ay, backZ, normal[0], normal[1], normal[2], 0, 1),
        ];
        pushQuad(wall, [0, 1, 2, 3], indices, sideIndices);
      }
    }
  }

  const mesh: MeshData = {
    vertices: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    frontFaceIndices: new Uint32Array(frontIndices),
    backFaceIndices: new Uint32Array(backIndices),
    sideWallIndices: new Uint32Array(sideIndices),
    width: grid.canvasWidth,
    height: grid.canvasHeight,
  };

  if (meshCache.size >= MESH_CACHE_MAX) meshCache.clear();
  meshCache.set(key, mesh);
  return mesh;
}

function pushQuad(
  vertexIndices: readonly number[],
  order: readonly number[],
  target: number[],
  group: number[],
): void {
  const [a, b, c, d] = order.map((index) => vertexIndices[index]!);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return;
  target.push(a, b, c, a, c, d);
  group.push(a, b, c, a, c, d);
}

export function clearText3dMeshCache(): void {
  meshCache.clear();
}
