"use client";

interface HeaderProps {
  connected: boolean;
  onRefresh: () => void;
  onClear: () => void;
}

export function Header({ connected, onRefresh, onClear }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3 bg-card">
      <div className="flex items-center gap-3">

        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-foreground">Orbyt</span>
          <span className="text-muted-foreground ml-1.5 font-normal">DevTools</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-card hover:bg-accent transition-colors"
        >
          Refresh
        </button>
        <button
          onClick={onClear}
          className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
        >
          Clear
        </button>
        <div className="flex items-center gap-2 ml-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-muted-foreground">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </header>
  );
}


