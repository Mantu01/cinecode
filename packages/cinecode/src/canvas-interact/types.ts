/** Tool types available in the interactive canvas. */
export type CanvasToolKind =
  | "select"
  | "rectangle"
  | "ellipse"
  | "line"
  | "path"
  | "text"
  | "brush"
  | "eraser"
  | "fill";

/** A single drawing operation on the canvas. */
export type CanvasOperation =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number }
  | { kind: "path"; points: [number, number][]; stroke?: string; strokeWidth?: number; fill?: string }
  | { kind: "text"; x: number; y: number; text: string; font?: string; fontSize?: number; color?: string }
  | { kind: "brush"; points: [number, number][]; color?: string; strokeWidth?: number }
  | { kind: "eraser"; x: number; y: number; radius: number }
  | { kind: "fill"; seedPoint: [number, number]; color: string };

/** A named layer containing operations. */
export interface CanvasLayer {
  readonly id: string;
  readonly name: string;
  readonly opacity: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly operations: CanvasOperation[];
}

/** The complete state of an interactive canvas. */
export interface CanvasState {
  readonly width: number;
  readonly height: number;
  readonly layers: CanvasLayer[];
  readonly activeTool: CanvasToolKind;
  readonly activeLayerId: string;
  readonly zoom: number;
  readonly pan: { x: number; y: number };
  readonly history: CanvasHistoryEntry[];
  readonly historyIndex: number;
}

export interface CanvasHistoryEntry {
  readonly snapshot: CanvasState;
  readonly timestamp: number;
}

export interface LayerReorderDrag {
  readonly layerId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly active: boolean;
}

/** Message types for the canvas WebSocket protocol. */
export type CanvasMessage =
  | { type: "canvas:create"; id: string; props: { width: number; height: number; name?: string } }
  | { type: "canvas:select"; id: string }
  | { type: "canvas:draw"; id: string; operation: CanvasOperation }
  | { type: "canvas:undo"; id: string }
  | { type: "canvas:redo"; id: string }
  | { type: "canvas:export"; id: string; format: "png" | "jpg" | "pdf" | "cinecode"; name?: string }
  | { type: "canvas:layer:move"; id: string; layerId: string; direction: "up" | "down" }
  | { type: "canvas:layer:reorder"; id: string; layerId: string; toIndex: number }
  | { type: "canvas:layer:toggle"; id: string; layerId: string; visible: boolean }
  | { type: "canvas:state:request"; id: string }
  | { type: "canvas:state:reply"; id: string; state: CanvasState }
  | { type: "canvas:error"; id: string; error: string };
