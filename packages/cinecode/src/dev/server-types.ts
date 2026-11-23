import type { WsClient } from "./transport.js";
import type { PreviewCameraState } from "../renderer/preview-engine.js";
import type { ResolutionScale } from "../renderer/scale.js";
import type { DevNode, DevServerOptions, PreviewFrame } from "./types.js";
import type { ModuleGraph } from "./module-graph.js";
import type { ManifestProject } from "../manifest/index.js";
import type { CheckReport } from "../cli/gate/check.js";
import type { ServerStatusMessage } from "./protocol.js";

export interface SessionCachedFrame {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly scale: ResolutionScale;
}

export interface ClientSession {
  readonly client: WsClient;
  selectedNodeId: string;
  isRendering: boolean;
  pendingFrame: { frame: number; scale?: ResolutionScale; generation: number } | null;
  camera?: PreviewCameraState;
  currentFrame: number;
  generation: number;
  readonly frameCache: Map<string, SessionCachedFrame>;
  cacheBytes: number;
}

export interface PreviewServerContext {
  readonly options: DevServerOptions;
  setOptions: (opts: DevServerOptions) => void;
  graph: ModuleGraph;
  projectSnapshot: ManifestProject;
  setProjectSnapshot: (p: ManifestProject) => void;
  readonly previews: Map<string, PreviewFrame>;
  readonly previewLru: Map<string, PreviewFrame>;
  readonly sessions: Map<number, ClientSession>;
  readonly validationCache: Map<string, CheckReport>;
  scale: ResolutionScale;
  setScale: (scale: ResolutionScale) => void;
  cachePreview: (key: string, preview: PreviewFrame) => PreviewFrame;
  producePreview: (node: DevNode, frame: number, scale?: ResolutionScale, camera?: PreviewCameraState) => Promise<PreviewFrame>;
  resolveComposition: (node: DevNode) => Promise<import("../core/types/index.js").Composition | null>;
  validate: () => Promise<CheckReport>;
  requestFrame: (session: ClientSession, frame: number, requestedScale?: ResolutionScale) => void;
  send: (client: WsClient, message: unknown) => void;
  broadcast: (message: unknown) => void;
  reject: (client: WsClient, code: string, type: string, message: string) => void;
  getStatus: (session?: ClientSession) => ServerStatusMessage;
  rebuildCaches: () => Promise<void>;
  startWatcher: () => void;
}
