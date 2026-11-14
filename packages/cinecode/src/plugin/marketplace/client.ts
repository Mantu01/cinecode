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
