"use client";

import type { PreviewErrorMessage } from "../lib/types";

interface ErrorDisplayProps {
  errors: PreviewErrorMessage[];
  onDismiss: (index: number) => void;
}

export function ErrorDisplay({ errors, onDismiss }: ErrorDisplayProps) {
  if (errors.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-destructive flex items-center gap-2">
          Errors ({errors.length})
        </h3>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {errors.map((error, i) => (
          <div
            key={i}
            className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <span className="font-mono text-destructive text-xs shrink-0">
                [{error.data.code}]
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-foreground">{error.data.message}</p>
                {error.data.fixHint && (
                  <p className="text-muted-foreground text-xs mt-1">
                    Fix: {error.data.fixHint}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDismiss(i)}
                className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
              >
                x
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
