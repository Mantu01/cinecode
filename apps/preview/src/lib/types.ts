export type ServerMessage =
  | PreviewFrameMessage
  | CompositionInfoMessage
  | PreviewErrorMessage
  | ProgressMessage
  | ReadyMessage
  | HeartbeatMessage;

export interface PreviewFrameMessage {
  type: "frame";
  data: {
    frame: number;
    buffer: string;
    width: number;
    height: number;
  };
}

export interface CompositionInfoMessage {
  type: "composition";
  data: CompositionMetadata;
}

export interface CompositionMetadata {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly trackCount: number;
  readonly clipCount: number;
}

export interface PreviewErrorMessage {
  type: "error";
  data: {
    code: string;
    message: string;
    fixHint?: string;
    location?: { file: string; line: number };
  };
}

export interface ProgressMessage {
  type: "progress";
  data: {
    current: number;
    total: number;
    percent: number;
    estimatedRemainingMs?: number;
  };
}

export interface ReadyMessage {
  type: "ready";
  data: { port: number; url: string; version: string };
}

export interface HeartbeatMessage {
  type: "heartbeat";
}
