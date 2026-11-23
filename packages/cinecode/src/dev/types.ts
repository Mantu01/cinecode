import type { CinecodeConfig } from "../core/types/index.js";
import type { ManifestProject } from "../manifest/index.js";

export type DevServerMode = "dev" | "preview";

export interface DevNode {
  readonly id: string;
  readonly kind: "image" | "audio" | "video" | "text" | "shape" | "3d" | "scene" | "timeline";
  readonly file: string;
  readonly name: string;
}

export interface DevServerOptions {
  readonly config: CinecodeConfig;
  readonly project: ManifestProject;
  readonly rootDir: string;
  readonly port: number;
  readonly host: string;
  readonly hmr: boolean;
  readonly allowNetwork?: boolean;
  readonly configPath: string;
  readonly mode?: DevServerMode;
}

export interface PreviewFrame {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly width?: number;
  readonly height?: number;
  readonly frame?: number;
  version?: number;
}
