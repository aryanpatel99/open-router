"use client";

import { useState } from "react";
import type { Step } from "@/lib/telemetry";
import { Separator } from "@/components/ui/separator";
import { formatCost, formatDuration } from "@/lib/utils";

interface StepDetailProps {
  step: Step;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function StepDetail({ step }: StepDetailProps) {
  return (
    <div className="border border-border rounded-lg bg-card">
      {/* Step header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h3 className="text-sm font-medium">
          Step {step.index + 1}
          <span className="text-muted-foreground ml-2 font-normal">
            ({step.provider} → {step.model})
          </span>
        </h3>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              step.status === "success"
                ? "bg-emerald-600/20 text-emerald-400"
                : step.status === "error"
                  ? "bg-red-600/20 text-red-400"
                  : "bg-yellow-600/20 text-yellow-400"
            }`}
          >
            {step.status}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {formatDuration(step.duration)}
          </span>
        </div>
      </div>

      {/* Request / Response split */}
      <div className="grid grid-cols-2 divide-x divide-border">
        {/* Request */}
        <div className="p-5 space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Request
          </h4>

          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Model</p>
            <p className="text-sm">{step.request.model}</p>
          </div>

          {step.request.provider_strategy && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Strategy</p>
              <p className="text-sm font-mono">{step.request.provider_strategy}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Messages</p>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap wrap-break-word font-mono">
              {JSON.stringify(step.request.messages, null, 2)}
            </pre>
          </div>

          {step.request.temperature !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                Temperature
              </p>
              <p className="text-sm font-mono">{step.request.temperature}</p>
            </div>
          )}

          <CollapsibleSection title="Raw Request">
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-64 whitespace-pre-wrap wrap-break-word font-mono">
              {JSON.stringify(step.request, null, 2)}
            </pre>
          </CollapsibleSection>
        </div>

        {/* Response */}
        <div className="p-5 space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Response
          </h4>

          {step.response ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Content</p>
                <p className="text-sm bg-muted rounded-md p-3 whitespace-pre-wrap wrap-break-word max-h-48 overflow-y-auto">
                  {step.response.content}
                </p>
              </div>

              {/* Token breakdown */}
              {(step.response.promptTokens !== undefined ||
                step.response.completionTokens !== undefined) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    Token Usage
                  </p>
                  <div className="space-y-1 text-sm font-mono">
                    {step.response.promptTokens !== undefined && (
                      <p>Prompt: {step.response.promptTokens}</p>
                    )}
                    {step.response.completionTokens !== undefined && (
                      <p>Completion: {step.response.completionTokens}</p>
                    )}
                    {step.response.totalTokens !== undefined && (
                      <p>Total: {step.response.totalTokens}</p>
                    )}
                    {!!step.response.thoughtsTokens && (
                      <p className="text-violet-400">
                        Thoughts: {step.response.thoughtsTokens}
                      </p>
                    )}
                    {!!step.response.cacheReadTokens && (
                      <p className="text-sky-400">
                        Cache read: {step.response.cacheReadTokens}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Cost */}
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Cost</p>
                <p className={`text-sm font-mono ${step.response.costMicros ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {formatCost(step.response.costMicros)}
                  {step.response.costMicros !== undefined && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({step.response.costMicros.toLocaleString()} µ)
                    </span>
                  )}
                </p>
              </div>

              {step.response.finishReason && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    Finish Reason
                  </p>
                  <span className="text-sm px-2 py-0.5 rounded bg-muted font-mono">
                    {step.response.finishReason}
                  </span>
                </div>
              )}

              {step.response.provider && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    Provider
                  </p>
                  <span className="text-sm px-2 py-0.5 rounded bg-muted">
                    {step.response.provider}
                  </span>
                </div>
              )}

              {step.response.actualModel && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    Actual Model Version
                  </p>
                  <p className="text-sm font-mono">{step.response.actualModel}</p>
                </div>
              )}

              <CollapsibleSection title="Raw Response">
                <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-64 whitespace-pre-wrap wrap-break-word font-mono">
                  {JSON.stringify(step.response, null, 2)}
                </pre>
              </CollapsibleSection>
            </>
          ) : step.error ? (
            <div>
              <p className="text-xs text-red-400 mb-1 uppercase tracking-wider">Error</p>
              <p className="text-sm text-red-300 font-mono bg-red-950/30 rounded-md p-3 wrap-break-word">
                {step.error}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pending...</p>
          )}
        </div>
      </div>
    </div>
  );
}
