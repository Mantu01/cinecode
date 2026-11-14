"use client";

interface CompositionPanelProps {
  name?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  trackCount: number;
  clipCount: number;
  currentFrame: number;
}

export function CompositionPanel({
  name,
  width,
  height,
  fps,
  duration,
  trackCount,
  clipCount,
  currentFrame,
}: CompositionPanelProps) {
  const currentTime = currentFrame / fps;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-primary inline-block" />
        Composition
      </h2>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Name</span>
          <span className="font-mono">{name ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Resolution</span>
          <span className="font-mono">{width}x{height}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">FPS</span>
          <span className="font-mono">{fps}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Duration</span>
          <span className="font-mono">{duration.toFixed(2)}s</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tracks</span>
          <span className="font-mono">{trackCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Clips</span>
          <span className="font-mono">{clipCount}</span>
        </div>
      </div>

      <div className="pt-3 border-t border-border space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Current Time</span>
          <span className="font-mono">{formatTime(currentTime)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Frame</span>
          <span className="font-mono">{currentFrame + 1} / {Math.ceil(duration * fps)}</span>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 30);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}
