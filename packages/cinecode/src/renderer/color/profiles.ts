import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

export type ColorSpace = "srgb" | "rec709" | "display-p3" | "rec2020" | "acescg";

export type WorkingColorSpace = "srgb" | "linear-srgb" | "rec709" | "acescg";

export type OutputColorSpace = "srgb" | "rec709" | "display-p3" | "rec2020";

export type TransferFunction = "srgb" | "bt709" | "bt2020" | "linear";

export type RgbTriplet = readonly [number, number, number];

export interface ColorSpaceDefinition {
  readonly name: ColorSpace;
  readonly label: string;
  readonly transfer: TransferFunction;
  readonly whitePoint: "D65" | "D60";
  readonly toXyz: readonly [RgbTriplet, RgbTriplet, RgbTriplet];
  readonly description: string;
}

const SRGB_TO_XYZ_D65: readonly [RgbTriplet, RgbTriplet, RgbTriplet] = [
  [0.4123908, 0.3575843, 0.1804808],
  [0.2126390, 0.7151687, 0.0721923],
  [0.0193308, 0.1191948, 0.9505322],
];

const P3_TO_XYZ_D65: readonly [RgbTriplet, RgbTriplet, RgbTriplet] = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0.0000000, 0.0451134, 1.0439444],
];

const REC2020_TO_XYZ_D65: readonly [RgbTriplet, RgbTriplet, RgbTriplet] = [
  [0.6369580, 0.1446169, 0.1688810],
  [0.2627002, 0.6779981, 0.0593017],
  [0.0000000, 0.0280727, 1.0609851],
];

const ACESCG_TO_XYZ_D60: readonly [RgbTriplet, RgbTriplet, RgbTriplet] = [
  [0.6624542, 0.1340042, 0.1561877],
  [0.2722287, 0.6740818, 0.0536895],
  [-0.0055746, 0.0040607, 1.0103391],
];

export const COLOR_SPACES: Readonly<Record<ColorSpace, ColorSpaceDefinition>> = {
  srgb: {
    name: "srgb",
    label: "sRGB IEC 61966-2-1",
    transfer: "srgb",
    whitePoint: "D65",
    toXyz: SRGB_TO_XYZ_D65,
    description: "Standard web and display color space",
  },
  rec709: {
    name: "rec709",
    label: "ITU-R BT.709",
    transfer: "bt709",
    whitePoint: "D65",
    toXyz: SRGB_TO_XYZ_D65,
    description: "HD broadcast color space with BT.709 transfer",
  },
  "display-p3": {
    name: "display-p3",
    label: "Display P3",
    transfer: "srgb",
    whitePoint: "D65",
    toXyz: P3_TO_XYZ_D65,
    description: "Wide-gamut display space used by iPhone and modern monitors",
  },
  rec2020: {
    name: "rec2020",
    label: "ITU-R BT.2020",
    transfer: "bt2020",
    whitePoint: "D65",
    toXyz: REC2020_TO_XYZ_D65,
    description: "UHD broadcast and HDR color space",
  },
  acescg: {
    name: "acescg",
    label: "ACEScg (AP1)",
    transfer: "linear",
    whitePoint: "D60",
    toXyz: ACESCG_TO_XYZ_D60,
    description: "Scene-linear ACES working space for VFX compositing",
  },
};

const BRADFORD = {
  d65ToD60: [
    [1.0478112, 0.0228866, -0.0501270],
    [0.0295424, 0.9904844, -0.0170491],
    [-0.0092345, 0.0150436, 0.7521316],
  ],
  d60ToD65: [
    [0.9555766, -0.0230393, 0.0631636],
    [-0.0282895, 1.0099416, 0.0210077],
    [0.0122982, -0.0204830, 1.3299098],
  ],
} as const;

type Matrix3 = readonly [RgbTriplet, RgbTriplet, RgbTriplet];

function multiplyMatrix(matrix: Matrix3, vector: RgbTriplet): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const output: number[][] = [];
  for (let row = 0; row < 3; row += 1) {
    const values: number[] = [];
    for (let column = 0; column < 3; column += 1) {
      values.push(
        left[row]![0]! * right[0]![column]! +
          left[row]![1]! * right[1]![column]! +
          left[row]![2]! * right[2]![column]!,
      );
    }
    output.push(values);
  }
  return output as unknown as Matrix3;
}

function invertMatrix(matrix: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) {
    throw new Error("[CC2501] Singular color transform matrix");
  }
  const inverse = 1 / determinant;
  return [
    [(e * i - f * h) * inverse, (c * h - b * i) * inverse, (b * f - c * e) * inverse],
    [(f * g - d * i) * inverse, (a * i - c * g) * inverse, (c * d - a * f) * inverse],
    [(d * h - e * g) * inverse, (b * g - a * h) * inverse, (a * e - b * d) * inverse],
  ];
}

function adaptiveMatrix(source: ColorSpaceDefinition, target: ColorSpaceDefinition): Matrix3 {
  const targetFromXyz = invertMatrix(target.toXyz);
  if (source.whitePoint === target.whitePoint) {
    return multiplyMatrices(targetFromXyz, source.toXyz);
  }
  const adaptation: Matrix3 = source.whitePoint === "D60" ? BRADFORD.d60ToD65 : BRADFORD.d65ToD60;
  return multiplyMatrices(targetFromXyz, multiplyMatrices(adaptation, source.toXyz));
}

function absDiff(left: ColorSpaceDefinition, right: ColorSpaceDefinition): boolean {
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (Math.abs(left.toXyz[row]![column]! - right.toXyz[row]![column]!) > 1e-9) return true;
    }
  }
  return false;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function bt709ToLinear(value: number): number {
  return value < 0.081 ? value / 4.5 : ((value + 0.099) / 1.099) ** (1 / 0.45);
}

function linearToBt709(value: number): number {
  return value < 0.018 ? value * 4.5 : 1.099 * value ** 0.45 - 0.099;
}

function bt2020ToLinear(value: number): number {
  return value < 0.0181 ? value / 4.5 : ((value - 0.0181) / 1.0993) ** (1 / 0.45);
}

function linearToBt2020(value: number): number {
  return value < 0.0181 ? value * 4.5 : 1.0993 * value ** 0.45 - 0.0181;
}

function encode(value: number, transfer: TransferFunction): number {
  switch (transfer) {
    case "srgb":
      return linearToSrgb(value);
    case "bt709":
      return linearToBt709(value);
    case "bt2020":
      return linearToBt2020(value);
    case "linear":
      return value;
  }
}

function decode(value: number, transfer: TransferFunction): number {
  switch (transfer) {
    case "srgb":
      return srgbToLinear(value);
    case "bt709":
      return bt709ToLinear(value);
    case "bt2020":
      return bt2020ToLinear(value);
    case "linear":
      return value;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export interface ColorTransform {
  readonly from: ColorSpace;
  readonly to: ColorSpace;
  readonly matrix: Matrix3;
  transformRgb(rgb: RgbTriplet): [number, number, number];
  transformBuffer(data: Uint8ClampedArray, options?: { readonly layout?: "rgba" | "bgra" }): void;
}

export function createColorTransform(from: ColorSpace, to: ColorSpace): ColorTransform {
  const source = COLOR_SPACES[from];
  const target = COLOR_SPACES[to];
  if (!source || !target) {
    throw new Error(`[CC2502] Unsupported color transform ${from} -> ${to}`);
  }
  const needsMatrix = from !== to && absDiff(source, target);
  const matrix: Matrix3 = needsMatrix
    ? adaptiveMatrix(source, target)
    : [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
  const identity = !needsMatrix && source.transfer === target.transfer;

  return {
    from,
    to,
    matrix,
    transformRgb(rgb) {
      if (identity) return [rgb[0], rgb[1], rgb[2]];
      const linearSource: RgbTriplet = [
        decode(clamp01(rgb[0]), source.transfer),
        decode(clamp01(rgb[1]), source.transfer),
        decode(clamp01(rgb[2]), source.transfer),
      ];
      const linearTarget = multiplyMatrix(matrix, linearSource);
      return [
        clamp01(encode(clamp01(linearTarget[0]), target.transfer)),
        clamp01(encode(clamp01(linearTarget[1]), target.transfer)),
        clamp01(encode(clamp01(linearTarget[2]), target.transfer)),
      ];
    },
    transformBuffer(data, options = {}) {
      if (identity) return;
      const layout = options.layout ?? "rgba";
      const offsetR = layout === "rgba" ? 0 : 2;
      const offsetB = layout === "rgba" ? 2 : 0;
      for (let index = 0; index + 3 < data.length; index += 4) {
        const alpha = data[index + 3]!;
        if (alpha === 0) continue;
        const sourcePixel: RgbTriplet = [
          (data[index + offsetR] ?? 0) / 255,
          (data[index + 1] ?? 0) / 255,
          (data[index + offsetB] ?? 0) / 255,
        ];
        const linearSource: RgbTriplet = [
          decode(sourcePixel[0], source.transfer),
          decode(sourcePixel[1], source.transfer),
          decode(sourcePixel[2], source.transfer),
        ];
        const linearTarget = multiplyMatrix(matrix, linearSource);
        data[index + offsetR] = Math.round(clamp01(encode(clamp01(linearTarget[0]), target.transfer)) * 255);
        data[index + 1] = Math.round(clamp01(encode(clamp01(linearTarget[1]), target.transfer)) * 255);
        data[index + offsetB] = Math.round(clamp01(encode(clamp01(linearTarget[2]), target.transfer)) * 255);
      }
    },
  };
}

export interface IccProfileInfo {
  readonly present: boolean;
  readonly profileName?: string;
  readonly colorSpace: ColorSpace;
  readonly version?: string;
  readonly rawSize?: number;
}

function sniffProfileName(profile: Buffer): string | undefined {
  const ascii = profile.toString("latin1");
  const markers: readonly [RegExp, string][] = [
    [/Display\s*P3/i, "Display P3"],
    [/ACES|ACEScg/i, "ACES"],
    [/Rec\.?\s*2020|BT\.?\s*2020/i, "Rec. 2020"],
    [/Rec\.?\s*709|BT\.?\s*709/i, "Rec. 709"],
    [/sRGB/i, "sRGB"],
  ];
  for (const [pattern, label] of markers) {
    if (pattern.test(ascii)) return label;
  }
  return undefined;
}

function colorSpaceFromProfileName(name: string | undefined): ColorSpace {
  if (!name) return "srgb";
  const normalized = name.toLowerCase();
  if (normalized.includes("display p3") || normalized.includes("p3")) return "display-p3";
  if (normalized.includes("2020")) return "rec2020";
  if (normalized.includes("709")) return "rec709";
  if (normalized.includes("aces")) return "acescg";
  return "srgb";
}

function readPngIcc(buf: Buffer): Buffer | null {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "iCCP" && length > 0) {
      const chunk = buf.subarray(dataStart, dataStart + length);
      const nullIndex = chunk.indexOf(0);
      if (nullIndex > 0) {
        const compressed = chunk.subarray(nullIndex + 2);
        try {
          return inflateSync(compressed);
        } catch {
          return null;
        }
      }
    }
    if (type === "IEND") break;
    offset = dataStart + length + 4;
  }
  return null;
}

function readJpegIcc(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  const segments: Buffer[] = [];
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1]!;
    const length = buf.readUInt16BE(offset + 2);
    const dataStart = offset + 4;
    if (marker === 0xe2 && buf.toString("latin1", dataStart, dataStart + 11) === "ICC_PROFILE") {
      segments.push(buf.subarray(dataStart + 14, dataStart + length - 2));
    }
    if (marker === 0xda) break;
    offset = dataStart + length - 2;
  }
  if (segments.length === 0) return null;
  return Buffer.concat(segments);
}

export function inspectIccProfile(input: Buffer | string): IccProfileInfo {
  const buffer = typeof input === "string" ? readFileSync(input) : input;
  const profile = readPngIcc(buffer) ?? readJpegIcc(buffer);
  if (!profile || profile.length < 128) {
    return { present: false, colorSpace: "srgb" };
  }
  const name = sniffProfileName(profile);
  const versionMajor = profile[8] ?? 0;
  const versionMinor = profile[9] ?? 0;
  return {
    present: true,
    profileName: name,
    colorSpace: colorSpaceFromProfileName(name),
    version: `${versionMajor}.${versionMinor}`,
    rawSize: profile.length,
  };
}

export interface ColorManagementConfig {
  readonly workingColorSpace?: WorkingColorSpace;
  readonly outputColorSpace?: OutputColorSpace;
  readonly enabled?: boolean;
}

export interface ResolvedColorManagement {
  readonly enabled: boolean;
  readonly workingColorSpace: WorkingColorSpace;
  readonly outputColorSpace: OutputColorSpace;
  readonly workingSpaceName: ColorSpace;
}

export function resolveColorManagementConfig(config: ColorManagementConfig = {}): ResolvedColorManagement {
  const working = config.workingColorSpace ?? "linear-srgb";
  const output = config.outputColorSpace ?? "srgb";
  const workingSpaceName: ColorSpace = working === "linear-srgb" ? "srgb" : working;
  return {
    enabled: config.enabled !== false,
    workingColorSpace: working,
    outputColorSpace: output,
    workingSpaceName,
  };
}

export function isLinearSpace(space: WorkingColorSpace | ColorSpace): boolean {
  return space === "linear-srgb" || space === "acescg";
}

export function convertPixelBuffer(
  data: Uint8ClampedArray,
  from: ColorSpace,
  to: ColorSpace,
  layout: "rgba" | "bgra" = "rgba",
): void {
  createColorTransform(from, to).transformBuffer(data, { layout });
}

export function getReferenceProfileMetadata(space: ColorSpace): {
  readonly label: string;
  readonly whitePoint: string;
  readonly transfer: TransferFunction;
  readonly description: string;
  readonly primaries: readonly [RgbTriplet, RgbTriplet, RgbTriplet];
} {
  const definition = COLOR_SPACES[space];
  return {
    label: definition.label,
    whitePoint: definition.whitePoint,
    transfer: definition.transfer,
    description: definition.description,
    primaries: definition.toXyz,
  };
}

export function listColorSpaces(): readonly ColorSpace[] {
  return Object.keys(COLOR_SPACES) as readonly ColorSpace[];
}
