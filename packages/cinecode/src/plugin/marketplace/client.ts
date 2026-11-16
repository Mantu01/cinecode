import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { verifyPluginSignature, type VerificationOptions } from "../security/signature.js";

export interface PluginPackageInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  kind: string;
  tags: string[];
  downloads: number;
  rating: number;
  minEngineVersion?: string;
  maxEngineVersion?: string;
  permissions?: string[];
  signature?: string;
}

export interface PluginFilters {
  tag?: string;
  kind?: string;
  minRating?: number;
}

export interface PluginSearchResult {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
}

const DEFAULT_CATALOG: PluginPackageInfo[] = [
  {
    name: "@cinecode/plugin-glitch-deluxe",
    version: "1.2.0",
    description: "Analog VHS tape tears, RGB offset jitter and scanlines",
    author: "Cinecode Core Team",
    kind: "effect",
    tags: ["effect", "glitch", "vhs", "analog"],
    downloads: 14200,
    rating: 4.9,
    minEngineVersion: "0.1.0",
    permissions: ["frame:process"],
  },
  {
    name: "@cinecode/plugin-spatial-audio-pro",
    version: "2.0.1",
    description: "Binaural and 3D ambisonic spatial audio rendering",
    author: "SoundWave Labs",
    kind: "audioProcessor",
    tags: ["audio", "spatial", "binaural", "3d"],
    downloads: 9800,
    rating: 4.8,
    minEngineVersion: "0.1.0",
    permissions: ["audio:process"],
  },
  {
    name: "@cinecode/plugin-film-stocks",
    version: "1.0.4",
    description: "Authentic Kodak and Fujifilm 35mm emulations with 3D LUTs",
    author: "Cinematic Labs",
    kind: "effect",
    tags: ["lut", "color", "film", "35mm"],
    downloads: 23100,
    rating: 5.0,
    minEngineVersion: "0.1.0",
    permissions: ["frame:process", "fs:read"],
  },
  {
    name: "@cinecode/plugin-liquid-transitions",
    version: "1.1.0",
    description: "Fluid simulation and morphing wipe transitions",
    author: "VFX Factory",
    kind: "transition",
    tags: ["transitions", "liquid", "wipe", "vfx"],
    downloads: 8700,
    rating: 4.7,
    minEngineVersion: "0.1.0",
    permissions: ["frame:process"],
  },
  {
    name: "@cinecode/plugin-ai-captions",
    version: "0.9.5",
    description: "Animated word-level karaoke subtitles and speech sync",
    author: "AI Media Team",
    kind: "effect",
    tags: ["ai", "captions", "subtitles", "typography"],
    downloads: 31200,
    rating: 4.9,
    minEngineVersion: "0.1.0",
    permissions: ["network:http", "store:write"],
  },
];

export class MarketplaceClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://registry.cinecode.dev/v1/plugins") {
    this.baseUrl = baseUrl;
  }

  public async searchPlugins(query = "", filters: PluginFilters = {}): Promise<PluginSearchResult[]> {
    const q = query.toLowerCase().trim();
    let results = DEFAULT_CATALOG;

    if (filters.tag) {
      const tagLower = filters.tag.toLowerCase();
      results = results.filter((p) => p.tags.some((t) => t.toLowerCase() === tagLower));
    }

    if (filters.kind) {
      results = results.filter((p) => p.kind === filters.kind);
    }

    if (filters.minRating) {
      results = results.filter((p) => p.rating >= (filters.minRating ?? 0));
    }

    if (q) {
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return results.map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      tags: p.tags,
      downloads: p.downloads,
      rating: p.rating,
    }));
  }

  public async fetchPluginInfo(packageName: string): Promise<PluginPackageInfo | undefined> {
    const found = DEFAULT_CATALOG.find((p) => p.name.toLowerCase() === packageName.toLowerCase());
    return found;
  }
}

export const marketplaceClient = new MarketplaceClient();

export interface PluginPackageDownload {
  readonly tarballUrl: string;
  readonly package: PluginPackageInfo;
}

const DEFAULT_REGISTRY_URL = "https://registry.cinecode.dev/api/plugins";
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

function retryDelay(attempt: number): number {
  return RETRY_BASE_MS * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PluginRegistryClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.CINECODE_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
  }

  async search(filters: PluginFilters): Promise<PluginSearchResult[]> {
    const params = new URLSearchParams();
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.minRating !== undefined) params.set("minRating", String(filters.minRating));
    const query = params.toString();
    const response = await this.fetchWithRetry(`${this.baseUrl}/search${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error(`Registry search failed: HTTP ${response.status}`);
    return (await response.json()) as PluginSearchResult[];
  }

  async getPackage(name: string, version?: string): Promise<PluginPackageDownload> {
    const response = await this.fetchWithRetry(`${this.baseUrl}/${encodeURIComponent(name)}/${encodeURIComponent(version ?? "latest")}`);
    if (!response.ok) throw new Error(`Registry lookup failed for '${name}@${version ?? "latest"}': HTTP ${response.status}`);
    const body = (await response.json()) as Partial<PluginPackageInfo> & { tarball?: string };
    if (!body.name || !body.version || !body.tarball) {
      throw new Error(`Registry response for '${name}' missing name/version/tarball fields`);
    }
    return {
      tarballUrl: body.tarball,
      package: {
        name: body.name,
        version: body.version,
        description: body.description ?? "",
        author: body.author ?? "",
        kind: body.kind ?? "effect",
        tags: body.tags ?? [],
        downloads: body.downloads ?? 0,
        rating: body.rating ?? 0,
        minEngineVersion: body.minEngineVersion,
        maxEngineVersion: body.maxEngineVersion,
        permissions: body.permissions,
        signature: body.signature,
      },
    };
  }

  async downloadPackage(name: string, version: string, dest: string, options: { verification?: VerificationOptions } = {}): Promise<PluginPackageInfo> {
    const download = await this.getPackage(name, version);
    await fs.promises.mkdir(dest, { recursive: true });
    const tarballPath = path.join(dest, "package.tgz");
    const response = await this.fetchWithRetry(download.tarballUrl);
    if (!response.ok) throw new Error(`Tarball download failed for '${name}@${version}': HTTP ${response.status}`);
    await fs.promises.writeFile(tarballPath, Buffer.from(await response.arrayBuffer()));
    extractTarball(tarballPath, dest);
    await fs.promises.rm(tarballPath, { force: true });

    const verification = await verifyPluginSignature(dest, options.verification);
    if (!verification.valid) {
      await fs.promises.rm(dest, { recursive: true, force: true });
      throw new Error(`Signature verification failed for '${name}@${version}': ${verification.error ?? verification.status}`);
    }
    return download.package;
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await fetch(url);
      } catch (error) {
        lastError = error;
        if (attempt < RETRY_ATTEMPTS - 1) await sleep(retryDelay(attempt));
      }
    }
    throw new Error(`Registry request to ${url} failed after ${RETRY_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

export const pluginRegistryClient = new PluginRegistryClient();

const TAR_BLOCK = 512;
const TAR_TYPE_OFFSET = 156;
const TAR_SIZE_OFFSET = 124;
const TAR_NAME_END = 100;
const TAR_LONGNAME_TYPE = "L";

function extractTarball(tarballPath: string, dest: string): void {
  const gunzipped = zlib.gunzipSync(fs.readFileSync(tarballPath));
  let offset = 0;
  let pendingLongName: string | null = null;
  while (offset + TAR_BLOCK <= gunzipped.length) {
    const header = gunzipped.subarray(offset, offset + TAR_BLOCK);
    offset += TAR_BLOCK;
    if (header.every((byte) => byte === 0)) {
      pendingLongName = null;
      if (offset + TAR_BLOCK > gunzipped.length) break;
      continue;
    }
    const typeFlag = String.fromCharCode(header[TAR_TYPE_OFFSET] ?? 0);
    const size = Number.parseInt(readTarString(header, TAR_SIZE_OFFSET, 12).replace(/[^0-9]/g, ""), 8) || 0;
    if (typeFlag === TAR_LONGNAME_TYPE) {
      pendingLongName = readTarString(header.subarray(TAR_BLOCK), 0, Infinity).slice(0, size).replace(/\0+$/, "");
      continue;
    }
    const name = pendingLongName ?? readTarString(header, 0, TAR_NAME_END);
    pendingLongName = null;
    const data = gunzipped.subarray(offset, offset + size);
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (!name || name.startsWith("PaxHeader")) continue;
    const target = path.join(dest, name.replace(/^\.\//, ""));
    if (typeFlag === "5") {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (typeFlag !== "0" && typeFlag !== "\0") continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

function readTarString(header: Uint8Array, offset: number, maxLength: number): string {
  let end = offset;
  const limit = Math.min(offset + maxLength, header.length);
  while (end < limit && header[end] !== 0) end += 1;
  return Buffer.from(header.subarray(offset, end)).toString("utf8");
}
