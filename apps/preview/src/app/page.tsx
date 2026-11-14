"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PreviewCanvas } from "../components/PreviewCanvas";
import { CompositionPanel } from "../components/CompositionPanel";
import { TimelineStrip } from "../components/TimelineStrip";
import { ErrorDisplay } from "../components/ErrorDisplay";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PreviewWebSocket } from "../lib/ws-client";
import type { ServerMessage, PreviewErrorMessage, CompositionMetadata } from "../lib/types";

const DEFAULT_DEV_URL = "ws://localhost:3001";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [ws, setWs] = useState<PreviewWebSocket | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [fps, setFps] = useState(30);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [metadata, setMetadata] = useState<CompositionMetadata | null>(null);
  const [errors, setErrors] = useState<PreviewErrorMessage[]>([]);
  const [frameData, setFrameData] = useState<string | undefined>();
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    const client = new PreviewWebSocket(DEFAULT_DEV_URL, (msg) => {
      switch (msg.type) {
        case "frame":
          setFrameData(msg.data.buffer);
          setCurrentFrame(msg.data.frame);
          break;
        case "composition":
          setMetadata(msg.data);
          setWidth(msg.data.width);
          setHeight(msg.data.height);
          setFps(msg.data.fps);
          setTotalFrames(Math.ceil(msg.data.duration * msg.data.fps));
          break;
        case "error":
          setErrors(prev => [...prev, msg as unknown as PreviewErrorMessage]);
          break;
        case "ready":
          setConnected(true);
          client.requestMetadata();
          break;
        case "heartbeat":
          break;
      }
    }, {
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
    });
    setWs(client);
    client.connect();
  }, []);

  const disconnect = useCallback(() => {
    ws?.close();
    setWs(null);
    setConnected(false);
    setIsPlaying(false);
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
  }, [ws]);

  const handleScrub = useCallback((frame: number) => {
    ws?.scrub(frame);
    ws?.requestPreview(frame, frame + 1);
    setCurrentFrame(frame);
  }, [ws]);

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      if (prev) {
        ws?.pause();
        if (playIntervalRef.current) clearInterval(playIntervalRef.current);
        return false;
      }
      const endFrame = Math.min(currentFrame + 30, totalFrames);
      ws?.play(currentFrame);
      ws?.requestPreview(currentFrame, endFrame);
      playIntervalRef.current = setInterval(() => {
        setCurrentFrame(p => {
          if (p >= totalFrames - 1) {
            if (playIntervalRef.current) clearInterval(playIntervalRef.current);
            setIsPlaying(false);
            return p;
          }
          const next = p + 1;
          ws?.requestPreview(next, Math.min(next + 10, totalFrames));
          return next;
        });
      }, 1000 / fps);
      return true;
    });
  }, [ws, currentFrame, totalFrames, fps]);

  useEffect(() => {
    connect();
    return () => ws?.close();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight">Cinecode Preview</h1>
        <div className="flex-1" />
        <ConnectionStatus
          connected={connected}
          url={DEFAULT_DEV_URL}
          onConnect={connect}
          onDisconnect={disconnect}
        />
      </header>

      <main className="flex-1 flex gap-4 p-4">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 min-h-64 bg-zinc-900 rounded-lg overflow-hidden">
            <PreviewCanvas
              frameData={frameData}
              width={width}
              height={height}
              currentFrame={currentFrame}
              totalFrames={totalFrames}
            />
          </div>

          <TimelineStrip
            totalFrames={totalFrames}
            currentFrame={currentFrame}
            fps={fps}
            isPlaying={isPlaying}
            onScrub={handleScrub}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              disabled={!connected}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => { ws?.requestPreview(0, 1); setCurrentFrame(0); }}
              className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
              disabled={!connected}
            >
              First Frame
            </button>
          </div>

          <ErrorDisplay
            errors={errors}
            onDismiss={(i) => setErrors(prev => prev.filter((_, idx) => idx !== i))}
          />
        </div>

        <aside className="w-64 shrink-0 space-y-4">
          <CompositionPanel
            name={metadata?.name}
            width={width}
            height={height}
            fps={fps}
            duration={totalFrames / fps}
            trackCount={metadata?.trackCount ?? 0}
            clipCount={metadata?.clipCount ?? 0}
            currentFrame={currentFrame}
          />
        </aside>
      </main>
    </div>
  );
}
