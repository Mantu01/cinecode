"use client";

import { useCallback } from "react";

interface TimelineStripProps {
  totalFrames: number;
  currentFrame: number;
  fps: number;
  isPlaying: boolean;
  onScrub: (frame: number) => void;
}

export function TimelineStrip({
  totalFrames,
  currentFrame,
  fps,
  isPlaying,
  onScrub,
}: TimelineStripProps) {
  const handleStripClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor(ratio * totalFrames)));
      onScrub(frame);
    },
    [totalFrames, onScrub],
  );

  const progress = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground font-mono">
        <span>{formatTime(0)}</span>
        <span>{formatTime(currentFrame / fps)}</span>
        <span>{formatTime(totalFrames / fps)}</span>
      </div>
      <div
        className="relative h-7 bg-muted rounded cursor-pointer overflow-hidden"
        onClick={handleStripClick}
      >
        <div
          className="absolute top-0 left-0 h-full bg-primary/30 transition-all"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary transition-all"
          style={{ left: `${progress}%` }}
        />
        {isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 bg-primary rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
