"use client";

interface ConnectionStatusProps {
  connected: boolean;
  url: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionStatus({ connected, url, onConnect, onDisconnect }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-card border border-border rounded-lg">
      <span
        className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
      />
      <span className="text-xs font-mono text-muted-foreground">{url}</span>
      <div className="ml-auto flex gap-2">
        {connected ? (
          <button
            onClick={onDisconnect}
            className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
