"use client";

import { useEffect, useRef, useCallback } from "react";

interface PreviewCanvasProps {
  frameData?: string;
  width: number;
  height: number;
  currentFrame: number;
  totalFrames: number;
}

export function PreviewCanvas({
  frameData,
  width,
  height,
  currentFrame,
  totalFrames,
}: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = canvas.parentElement;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const scale = Math.min(
      containerWidth / width,
      containerHeight / height,
    );

    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawW = width * scale;
    const drawH = height * scale;
    const offsetX = (canvas.width - drawW) / 2;
    const offsetY = (canvas.height - drawH) / 2;

    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(4, 4, 130, 24);
    ctx.fillStyle = "#ffffff";
    ctx.font = "11px monospace";
    ctx.fillText(`Frame ${currentFrame + 1}/${totalFrames}`, 8, 20);
  }, [width, height, currentFrame, totalFrames]);

  useEffect(() => {
    if (!frameData) return;
    const src = `data:image/png;base64,${frameData}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      drawFrame();
    };
    img.src = src;
  }, [frameData, drawFrame]);

  useEffect(() => {
    drawFrame();
  }, [drawFrame]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{ imageRendering: "auto" }}
      />
      {!frameData && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
          <div className="text-center">
            <p className="text-sm mb-1">No preview</p>
            <p className="text-xs text-zinc-600">Connect to dev server</p>
          </div>
        </div>
      )}
    </div>
  );
}
