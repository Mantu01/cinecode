import type { PointCloudData } from "./types.js";

export interface CsvParseOptions {
  delimiter?: string;
  hasHeader?: boolean;
}

function computeBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = positions[0] ?? 0;
  let minY = positions[1] ?? 0;
  let minZ = positions[2] ?? 0;
  let maxX = positions[0] ?? 0;
  let maxY = positions[1] ?? 0;
  let maxZ = positions[2] ?? 0;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function parseXyzPointCloud(data: string): PointCloudData {
  const lines = data.split(/\r?\n/);
  const posArr: number[] = [];
  const colArr: number[] = [];
  const intArr: number[] = [];
  let hasColors = false;
  let hasIntensities = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const x = Number.parseFloat(parts[0] ?? "0");
    const y = Number.parseFloat(parts[1] ?? "0");
    const z = Number.parseFloat(parts[2] ?? "0");
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    posArr.push(x, y, z);

    if (parts.length >= 6) {
      let r = Number.parseFloat(parts[3] ?? "0");
      let g = Number.parseFloat(parts[4] ?? "0");
      let b = Number.parseFloat(parts[5] ?? "0");
      if (r > 1 || g > 1 || b > 1) {
        r /= 255;
        g /= 255;
        b /= 255;
      }
      colArr.push(r, g, b);
      hasColors = true;
      if (parts.length >= 7) {
        const val = Number.parseFloat(parts[6] ?? "0");
        intArr.push(Number.isNaN(val) ? 0 : val);
        hasIntensities = true;
      }
    } else if (parts.length === 4) {
      const val = Number.parseFloat(parts[3] ?? "0");
      intArr.push(Number.isNaN(val) ? 0 : val);
      hasIntensities = true;
    }
  }

  const positions = new Float32Array(posArr);
  return {
    positions,
    colors: hasColors ? new Float32Array(colArr) : undefined,
    intensities: hasIntensities ? new Float32Array(intArr) : undefined,
    count: positions.length / 3,
    bounds: computeBounds(positions),
  };
}

export function parseCsvPointCloud(data: string, options?: CsvParseOptions): PointCloudData {
  const lines = data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !lines[0]) {
    const pos = new Float32Array(0);
    return { positions: pos, count: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
  }

  const firstLine = lines[0];
  const delim = options?.delimiter ?? (firstLine.includes(",") ? "," : firstLine.includes(";") ? ";" : "\t");
  let startIdx = 0;
  const headerMap: Record<string, number> = {};
  const firstParts = firstLine.split(delim).map((s) => s.trim().toLowerCase());
  const isHeader = options?.hasHeader ?? firstParts.some((p) => p === "x" || p === "y" || p === "z" || Number.isNaN(Number(p)));

  if (isHeader) {
    firstParts.forEach((name, idx) => {
      headerMap[name] = idx;
    });
    startIdx = 1;
  } else {
    headerMap.x = 0;
    headerMap.y = 1;
    headerMap.z = 2;
    headerMap.r = 3;
    headerMap.g = 4;
    headerMap.b = 5;
    headerMap.intensity = 6;
  }

  const xi = headerMap.x ?? 0;
  const yi = headerMap.y ?? 1;
  const zi = headerMap.z ?? 2;
  const ri = headerMap.r ?? headerMap.red;
  const gi = headerMap.g ?? headerMap.green;
  const bi = headerMap.b ?? headerMap.blue;
  const ii = headerMap.intensity ?? headerMap.scalar ?? headerMap.val;
  const ci = headerMap.classification ?? headerMap.class ?? headerMap.label;

  const posArr: number[] = [];
  const colArr: number[] = [];
  const intArr: number[] = [];
  const clsArr: number[] = [];
  const hasColors = ri !== undefined && gi !== undefined && bi !== undefined;
  const hasIntensities = ii !== undefined;
  const hasClass = ci !== undefined;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(delim);
    if (parts.length <= Math.max(xi, yi, zi)) continue;
    const x = Number.parseFloat(parts[xi] ?? "0");
    const y = Number.parseFloat(parts[yi] ?? "0");
    const z = Number.parseFloat(parts[zi] ?? "0");
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    posArr.push(x, y, z);

    if (hasColors && parts.length > Math.max(ri ?? 0, gi ?? 0, bi ?? 0)) {
      let r = Number.parseFloat(parts[ri!] ?? "0");
      let g = Number.parseFloat(parts[gi!] ?? "0");
      let b = Number.parseFloat(parts[bi!] ?? "0");
      if (r > 1 || g > 1 || b > 1) {
        r /= 255;
        g /= 255;
        b /= 255;
      }
      colArr.push(r, g, b);
    }

    if (hasIntensities && parts.length > (ii ?? 0)) {
      const v = Number.parseFloat(parts[ii!] ?? "0");
      intArr.push(Number.isNaN(v) ? 0 : v);
    }

    if (hasClass && parts.length > (ci ?? 0)) {
      const c = Number.parseInt(parts[ci!] ?? "0", 10);
      clsArr.push(Number.isNaN(c) ? 0 : c);
    }
  }

  const positions = new Float32Array(posArr);
  return {
    positions,
    colors: hasColors ? new Float32Array(colArr) : undefined,
    intensities: hasIntensities ? new Float32Array(intArr) : undefined,
    classifications: hasClass ? new Uint16Array(clsArr) : undefined,
    count: positions.length / 3,
    bounds: computeBounds(positions),
  };
}

export function parseJsonPointCloud(data: string | unknown): PointCloudData {
  const json = typeof data === "string" ? JSON.parse(data) : data;
  const items: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as Record<string, unknown>).points)
    ? ((json as Record<string, unknown>).points as unknown[])
    : [];

  const posArr: number[] = [];
  const colArr: number[] = [];
  const intArr: number[] = [];
  const clsArr: number[] = [];
  let hasColors = false;
  let hasIntensities = false;
  let hasClass = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (Array.isArray(item)) {
      if (item.length < 3) continue;
      posArr.push(Number(item[0]), Number(item[1]), Number(item[2]));
      if (item.length >= 6) {
        let r = Number(item[3]);
        let g = Number(item[4]);
        let b = Number(item[5]);
        if (r > 1 || g > 1 || b > 1) {
          r /= 255;
          g /= 255;
          b /= 255;
        }
        colArr.push(r, g, b);
        hasColors = true;
        if (item.length >= 7) {
          intArr.push(Number(item[6]));
          hasIntensities = true;
        }
      } else if (item.length === 4) {
        intArr.push(Number(item[3]));
        hasIntensities = true;
      }
    } else if (item && typeof item === "object") {
      const p = item as Record<string, number>;
      const x = p.x ?? p.X ?? 0;
      const y = p.y ?? p.Y ?? 0;
      const z = p.z ?? p.Z ?? 0;
      posArr.push(x, y, z);

      if ("r" in p || "red" in p) {
        let r = p.r ?? p.red ?? 0;
        let g = p.g ?? p.green ?? 0;
        let b = p.b ?? p.blue ?? 0;
        if (r > 1 || g > 1 || b > 1) {
          r /= 255;
          g /= 255;
          b /= 255;
        }
        colArr.push(r, g, b);
        hasColors = true;
      }
      if ("intensity" in p || "scalar" in p || "value" in p) {
        intArr.push(p.intensity ?? p.scalar ?? p.value ?? 0);
        hasIntensities = true;
      }
      if ("classification" in p || "class" in p || "label" in p) {
        clsArr.push(p.classification ?? p.class ?? p.label ?? 0);
        hasClass = true;
      }
    }
  }

  const positions = new Float32Array(posArr);
  return {
    positions,
    colors: hasColors ? new Float32Array(colArr) : undefined,
    intensities: hasIntensities ? new Float32Array(intArr) : undefined,
    classifications: hasClass ? new Uint16Array(clsArr) : undefined,
    count: positions.length / 3,
    bounds: computeBounds(positions),
  };
}

export function parsePcdPointCloud(data: string | ArrayBuffer | Uint8Array): PointCloudData {
  let headerText = "";
  let binaryOffset = -1;
  let buffer: Uint8Array;

  if (typeof data === "string") {
    const match = data.match(/^DATA\s+(\w+)/m);
    if (!match || match.index === undefined) throw new Error("Invalid PCD file: missing DATA header");
    headerText = data.substring(0, match.index + match[0].length);
    buffer = new TextEncoder().encode(data);
  } else {
    buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    const textChunk = new TextDecoder("utf-8").decode(buffer.subarray(0, Math.min(buffer.length, 4096)));
    const match = textChunk.match(/^DATA\s+(\w+)\r?\n/m);
    if (!match || match.index === undefined) throw new Error("Invalid PCD header");
    headerText = textChunk.substring(0, match.index + match[0].length);
    binaryOffset = match.index + match[0].length;
  }

  const lines = headerText.split(/\r?\n/);
  const header: Record<string, string[]> = {};
  let dataMode = "ascii";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const key = (parts[0] ?? "").toUpperCase();
    header[key] = parts.slice(1);
    if (key === "DATA") {
      dataMode = (parts[1] ?? "ascii").toLowerCase();
    }
  }

  const fields = header.FIELDS || ["x", "y", "z"];
  const sizes = (header.SIZE || []).map((s) => Number.parseInt(s, 10));
  const types = header.TYPE || [];
  const points = Number.parseInt((header.POINTS?.[0] || "0"), 10);

  const xi = fields.indexOf("x");
  const yi = fields.indexOf("y");
  const zi = fields.indexOf("z");
  const rgbi = fields.indexOf("rgb");
  const inti = fields.indexOf("intensity");

  const posArr = new Float32Array(points * 3);
  const colArr = rgbi !== -1 ? new Float32Array(points * 3) : undefined;
  const intArr = inti !== -1 ? new Float32Array(points) : undefined;

  if (dataMode === "ascii") {
    const fullText = typeof data === "string" ? data : new TextDecoder("utf-8").decode(buffer);
    const lastLine = lines[lines.length - 1] ?? "";
    const dataStart = fullText.indexOf(lastLine) + lastLine.length;
    const bodyLines = fullText.substring(dataStart).trim().split(/\r?\n/);

    let written = 0;
    for (let i = 0; i < bodyLines.length && written < points; i++) {
      const bLine = bodyLines[i];
      if (!bLine) continue;
      const parts = bLine.trim().split(/\s+/);
      if (parts.length < fields.length) continue;

      const x = Number.parseFloat(parts[xi] ?? "0");
      const y = Number.parseFloat(parts[yi] ?? "0");
      const z = Number.parseFloat(parts[zi] ?? "0");
      posArr[written * 3] = x;
      posArr[written * 3 + 1] = y;
      posArr[written * 3 + 2] = z;

      if (rgbi !== -1 && colArr) {
        const rgbVal = Number.parseInt(parts[rgbi] ?? "0", 10);
        colArr[written * 3] = ((rgbVal >> 16) & 0xff) / 255;
        colArr[written * 3 + 1] = ((rgbVal >> 8) & 0xff) / 255;
        colArr[written * 3 + 2] = (rgbVal & 0xff) / 255;
      }
      if (inti !== -1 && intArr) {
        intArr[written] = Number.parseFloat(parts[inti] ?? "0");
      }
      written++;
    }
  } else if (dataMode === "binary") {
    let stride = 0;
    for (let i = 0; i < sizes.length; i++) {
      stride += sizes[i] ?? 0;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset + binaryOffset);

    for (let i = 0; i < points; i++) {
      const base = i * stride;
      let offset = 0;
      for (let f = 0; f < fields.length; f++) {
        const size = sizes[f] ?? 4;
        const type = types[f] ?? "F";
        let val = 0;
        if (type === "F") {
          val = size === 8 ? view.getFloat64(base + offset, true) : view.getFloat32(base + offset, true);
        } else if (type === "U") {
          val = size === 1 ? view.getUint8(base + offset) : size === 2 ? view.getUint16(base + offset, true) : view.getUint32(base + offset, true);
        } else if (type === "I") {
          val = size === 1 ? view.getInt8(base + offset) : size === 2 ? view.getInt16(base + offset, true) : view.getInt32(base + offset, true);
        }

        if (f === xi) posArr[i * 3] = val;
        else if (f === yi) posArr[i * 3 + 1] = val;
        else if (f === zi) posArr[i * 3 + 2] = val;
        else if (f === rgbi && colArr) {
          const uintVal = view.getUint32(base + offset, true);
          colArr[i * 3] = ((uintVal >> 16) & 0xff) / 255;
          colArr[i * 3 + 1] = ((uintVal >> 8) & 0xff) / 255;
          colArr[i * 3 + 2] = (uintVal & 0xff) / 255;
        } else if (f === inti && intArr) {
          intArr[i] = val;
        }

        offset += size;
      }
    }
  }

  return {
    positions: posArr,
    colors: colArr,
    intensities: intArr,
    count: points,
    bounds: computeBounds(posArr),
  };
}

export function parsePointCloud(
  data: string | ArrayBuffer | Uint8Array,
  format?: "csv" | "json" | "xyz" | "pcd",
): PointCloudData {
  if (format === "pcd") return parsePcdPointCloud(data);
  if (format === "csv") return parseCsvPointCloud(typeof data === "string" ? data : new TextDecoder().decode(data));
  if (format === "xyz") return parseXyzPointCloud(typeof data === "string" ? data : new TextDecoder().decode(data));
  if (format === "json") return parseJsonPointCloud(data);

  if (typeof data !== "string") {
    const head = new TextDecoder().decode(new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, 0, 100));
    if (head.includes("# .PCD") || head.includes("VERSION .7") || head.includes("VERSION 0.7")) {
      return parsePcdPointCloud(data);
    }
    const text = new TextDecoder().decode(data);
    return parsePointCloud(text);
  }

  const trimmed = data.trim();
  if (trimmed.startsWith("# .PCD") || trimmed.includes("FIELDS ") || trimmed.includes("DATA ")) {
    return parsePcdPointCloud(data);
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonPointCloud(data);
  }
  if (trimmed.includes(",") || trimmed.includes(";")) {
    return parseCsvPointCloud(data);
  }
  return parseXyzPointCloud(data);
}
