"use client";

import type { Run } from "@/lib/telemetry";
import { Badge } from "@/components/ui/badge";
import { formatCost, formatDuration } from "@/lib/utils";

interface RunSummaryProps {
  run: Run;
}

export function RunSummary({ run }: RunSummaryProps) {
  return (
    <div className="border border-border rounded-lg p-5 bg-card">
      {/* Row 1: Status / Operation / Model / Provider */}
      <div className="grid grid-cols-4 gap-6">
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Status</p>
          <Badge
            variant="outline"
            className={
              run.status === "success"
                ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30"
                : run.status === "error"
                  ? "bg-red-600/20 text-red-400 border-red-600/30"
                  : "bg-yellow-600/20 text-yellow-400 border-yellow-600/30"
            }
          >
            {run.status}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Operation</p>
          <Badge variant="outline">{run.operation}</Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Model</p>
          <p className="text-sm">{run.model}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Provider</p>
          <p className="text-sm">{run.provider || "—"}</p>
        </div>
      </div>

      {/* Row 2: Duration / Tokens */}
      <div className="grid grid-cols-4 gap-6 mt-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Duration</p>
          <p className="text-sm font-mono">{formatDuration(run.duration)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Prompt Tokens</p>
          <p className="text-sm font-mono">{run.promptTokens ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Completion Tokens</p>
          <p className="text-sm font-mono">{run.completionTokens ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Total Tokens</p>
          <p className="text-sm font-mono">{run.totalTokens ?? "—"}</p>
        </div>
      </div>

      {/* Row 3: Thoughts / Cache / Cost */}
      <div className="grid grid-cols-4 gap-6 mt-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Thoughts Tokens</p>
          <p className={`text-sm font-mono ${run.thoughtsTokens ? "text-violet-400" : ""}`}>
            {run.thoughtsTokens ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Cache Read Tokens</p>
          <p className={`text-sm font-mono ${run.cacheReadTokens ? "text-sky-400" : ""}`}>
            {run.cacheReadTokens ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Cost (USD)</p>
          <p className={`text-sm font-mono ${run.costMicros ? "text-emerald-400" : ""}`}>
            {formatCost(run.costMicros)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Steps</p>
          <p className="text-sm font-mono">{run.steps.length}</p>
        </div>
      </div>

      {/* Step type badges */}
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Steps</p>
        <div className="flex gap-2 flex-wrap">
          {run.steps.map((s, i) => (
            <Badge
              key={i}
              variant="outline"
              className={
                s.status === "success"
                  ? "text-emerald-400 border-emerald-600/30"
                  : s.status === "error"
                    ? "text-red-400 border-red-600/30"
                    : "text-yellow-400 border-yellow-600/30"
              }
            >
              {i + 1}. {s.provider} → {s.model} ({s.status})
            </Badge>
          ))}
        </div>
      </div>

      {/* Error */}
      {run.error && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-red-400 mb-2 uppercase tracking-wider">Error</p>
          <p className="text-sm text-red-300 font-mono bg-red-950/30 rounded p-3 wrap-break-word">
            {run.error}
          </p>
        </div>
      )}
    </div>
  );
}
