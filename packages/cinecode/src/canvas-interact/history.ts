export interface HistoryAction {
  readonly kind: string;
}

export interface HistoryOptions {
  readonly maxDepth?: number;
}

export const DEFAULT_HISTORY_DEPTH = 50;

export class ActionHistory<T extends HistoryAction = HistoryAction> {
  private history: T[] = [];
  private redoStack: T[] = [];
  private readonly maxDepth: number;

  constructor(options: HistoryOptions = {}) {
    const requested = options.maxDepth ?? DEFAULT_HISTORY_DEPTH;
    this.maxDepth = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_HISTORY_DEPTH;
  }

  push(action: T): void {
    this.history.push(action);
    if (this.history.length > this.maxDepth) {
      this.history = this.history.slice(this.history.length - this.maxDepth);
    }
    this.redoStack = [];
  }

  undo(): T | null {
    const action = this.history.pop();
    if (!action) return null;
    this.redoStack.push(action);
    if (this.redoStack.length > this.maxDepth) {
      this.redoStack = this.redoStack.slice(this.redoStack.length - this.maxDepth);
    }
    return action;
  }

  redo(): T | null {
    const action = this.redoStack.pop();
    if (!action) return null;
    this.history.push(action);
    return action;
  }

  peekUndo(): T | null {
    return this.history[this.history.length - 1] ?? null;
  }

  peekRedo(): T | null {
    return this.redoStack[this.redoStack.length - 1] ?? null;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get size(): number {
    return this.history.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }

  get depth(): number {
    return this.maxDepth;
  }

  clear(): void {
    this.history = [];
    this.redoStack = [];
  }
}
