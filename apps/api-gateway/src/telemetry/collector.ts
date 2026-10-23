import crypto from "crypto";
import type { Run, Step, StepRequest, StepResponse } from "./types.ts";
import { saveRun } from "./storage.ts";
import { notifyDevtools } from "./notifier.ts";

export interface RunOwner {
  userId?: number;
  apiKeyId?: number;
}

export class TelemetryCollector {
  private run: Run;
  // serializes writes so an older snapshot never overwrites a newer one
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(input: StepRequest, owner: RunOwner = {}) {
    this.run = {
      id: crypto.randomUUID(),
      status: "pending",
      operation: "chat",
      model: input.model,
      startedAt: Date.now(),
      userId: owner.userId,
      apiKeyId: owner.apiKeyId,
      steps: [],
      input,
    };

    this.save();
  }

  get runId(): string {
    return this.run.id;
  }

  // ─── Step Tracking ───────────────────────────────────────────

  startStep(model: string, provider: string, request: StepRequest): number {
    const step: Step = {
      index: this.run.steps.length,
      model,
      provider,
      status: "pending",
      startedAt: Date.now(),
      request,
    };

    this.run.steps.push(step);
    this.save();
    return step.index;
  }

  completeStep(stepIndex: number, response: StepResponse): void {
    const step = this.run.steps[stepIndex];
    if (!step) return;

    step.status = "success";
    step.completedAt = Date.now();
    step.duration = step.completedAt - step.startedAt;
    step.response = response;

    this.save();
  }

  failStep(stepIndex: number, error: string): void {
    const step = this.run.steps[stepIndex];
    if (!step) return;

    step.status = "error";
    step.completedAt = Date.now();
    step.duration = step.completedAt - step.startedAt;
    step.error = error;

    this.save();
  }

  // ─── Run Completion ──────────────────────────────────────────

  completeRun(response: StepResponse): void {
    this.run.status = "success";
    this.run.completedAt = Date.now();
    this.run.duration = this.run.completedAt - this.run.startedAt;
    this.run.provider = response.provider;
    this.run.promptTokens = response.promptTokens;
    this.run.completionTokens = response.completionTokens;
    this.run.totalTokens = response.totalTokens;
    this.run.thoughtsTokens = response.thoughtsTokens;
    this.run.cacheReadTokens = response.cacheReadTokens;
    this.run.costMicros = response.costMicros;

    this.save();
  }

  failRun(error: string): void {
    if (this.run.status === "error") return;
    this.run.status = "error";
    this.run.completedAt = Date.now();
    this.run.duration = this.run.completedAt - this.run.startedAt;
    this.run.error = error;

    this.save();
  }

  // ─── Persistence ─────────────────────────────────────────────

  private save(): void {
    // snapshot now — the run object keeps mutating while writes are queued
    const snapshot: Run = structuredClone(this.run);
    this.saveQueue = this.saveQueue
      .then(() => saveRun(snapshot))
      .then(() => notifyDevtools())
      .catch(() => {}); // never throw into the LLM call
  }
}
