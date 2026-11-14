import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

export interface CubeLut {
  readonly title?: string;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
  readonly type: "1d" | "3d";
  readonly size: number;
  readonly data: Float32Array;
}

export const MAX_CUBE_LUT_SIZE = 256;

const KEYWORDS = new Set([
  "TITLE",
  "DOMAIN_MIN",
  "DOMAIN_MAX",
  "LUT_1D_SIZE",
  "LUT_3D_SIZE",
  "LUT_1D_INPUT_RANGE",
  "LUT_3D_INPUT_RANGE",
]);

function parseFloats(line: string, lineNumber: number, expected: number, source: string): number[] {
  const values = line.trim().split(/\s+/).map(Number);
  if (values.length !== expected) {
    throw new Error(
      `CC6001: Expected ${expected} values per line but found ${values.length} at line ${lineNumber} of ${source}`,
    );
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`CC6001: Expected numeric values but found non-numeric token at line ${lineNumber} of ${source}`);
  }
  return values;
}

function parseTitle(line: string): string {
  const quoted = /TITLE\s+"([^"]*)"/i.exec(line);
  if (quoted) return quoted[1]!;
  return line.replace(/^TITLE\s+/i, "").trim();
}

export function parseCubeLut(content: string, source = "<cube>"): CubeLut {
  const lines = content.split(/\r?\n/);
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let oneDimensionalSize: number | null = null;
  let threeDimensionalSize: number | null = null;
  const dataLines: { values: number[]; lineNumber: number }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const keyword = line.split(/\s+/)[0]?.toUpperCase() ?? "";
    if (KEYWORDS.has(keyword)) {
      if (keyword === "TITLE") title = parseTitle(line);
      if (keyword === "DOMAIN_MIN") {
        const [r, g, b] = parseFloats(line.slice(keyword.length), lineNumber, 3, source);
        domainMin = [r!, g!, b!];
      }
      if (keyword === "DOMAIN_MAX") {
        const [r, g, b] = parseFloats(line.slice(keyword.length), lineNumber, 3, source);
        domainMax = [r!, g!, b!];
      }
      if (keyword === "LUT_1D_INPUT_RANGE" || keyword === "LUT_3D_INPUT_RANGE") {
        const [minimum, maximum] = parseFloats(line.slice(keyword.length), lineNumber, 2, source);
        domainMin = [minimum!, minimum!, minimum!];
        domainMax = [maximum!, maximum!, maximum!];
      }
      if (keyword === "LUT_1D_SIZE" || keyword === "LUT_3D_SIZE") {
        const values = parseFloats(line.slice(keyword.length), lineNumber, 1, source);
        const size = Math.trunc(values[0]!);
        if (size < 2 || size > MAX_CUBE_LUT_SIZE) {
          throw new Error(
            `CC6002: ${keyword} must be between 2 and ${MAX_CUBE_LUT_SIZE} at line ${lineNumber} of ${source}`,
          );
        }
        if (keyword === "LUT_1D_SIZE") oneDimensionalSize = size;
        else threeDimensionalSize = size;
      }
      continue;
    }

    dataLines.push({ values: parseFloats(line, lineNumber, 3, source), lineNumber });
  }

  if (oneDimensionalSize !== null && threeDimensionalSize !== null) {
    throw new Error(`CC6003: ${source} declares both LUT_1D_SIZE and LUT_3D_SIZE`);
  }
  if (oneDimensionalSize === null && threeDimensionalSize === null) {
    throw new Error(`CC6004: ${source} is missing LUT_1D_SIZE or LUT_3D_SIZE`);
  }
  if (domainMax[0] <= domainMin[0] || domainMax[1] <= domainMin[1] || domainMax[2] <= domainMin[2]) {
    throw new Error(`CC6005: DOMAIN_MAX must be greater than DOMAIN_MIN in ${source}`);
  }

  const type: "1d" | "3d" = threeDimensionalSize !== null ? "3d" : "1d";
  const size = (threeDimensionalSize ?? oneDimensionalSize)!;
  const expectedEntries = type === "3d" ? size ** 3 : size;
  if (dataLines.length !== expectedEntries) {
    throw new Error(
      `CC6006: LUT size mismatch in ${source}: expected ${expectedEntries} entries, found ${dataLines.length}`,
    );
  }
  if (dataLines.length === 0) {
    throw new Error(`CC6007: ${source} contains no LUT data`);
  }

  const data = new Float32Array(expectedEntries * 3);
  for (let index = 0; index < dataLines.length; index += 1) {
    const entry = dataLines[index]!;
    data[index * 3] = entry.values[0]!;
    data[index * 3 + 1] = entry.values[1]!;
    data[index * 3 + 2] = entry.values[2]!;
  }

  return { title, domainMin, domainMax, type, size, data };
}

export async function loadCubeLut(filePath: string): Promise<CubeLut> {
  return parseCubeLut(await readFile(filePath, "utf-8"), filePath);
}

export function loadCubeLutSync(filePath: string): CubeLut {
  return parseCubeLut(readFileSync(filePath, "utf-8"), filePath);
}

export function serializeCubeLut(lut: CubeLut): string {
  const lines: string[] = [];
  if (lut.title) lines.push(`TITLE "${lut.title}"`);
  lines.push(`DOMAIN_MIN ${lut.domainMin.join(" ")}`);
  lines.push(`DOMAIN_MAX ${lut.domainMax.join(" ")}`);
  lines.push(lut.type === "3d" ? `LUT_3D_SIZE ${lut.size}` : `LUT_1D_SIZE ${lut.size}`);
  for (let index = 0; index < lut.data.length; index += 3) {
    lines.push(`${lut.data[index]} ${lut.data[index + 1]} ${lut.data[index + 2]}`);
  }
  return `${lines.join("\n")}\n`;
}
