"use client";

import { useState, useEffect, useCallback } from "react";
import type { Run, TelemetryData } from "./telemetry";

export function useRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      const data: TelemetryData = await res.json();
      setRuns(data.runs);
    } catch {
      console.error("Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, []);

  const clearRuns = useCallback(async () => {
    try {
      await fetch("/api/runs", { method: "DELETE" });
      setRuns([]);
    } catch {
      console.error("Failed to clear runs");
    }
  }, []);

  // SSE connection for real-time updates
  useEffect(() => {
    fetchRuns();

    const eventSource = new EventSource("/api/events");

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "update") {
        fetchRuns();
      }
      if (data.type === "connected") {
        setConnected(true);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchRuns]);

  return { runs, loading, connected, refresh: fetchRuns, clearRuns };
}
