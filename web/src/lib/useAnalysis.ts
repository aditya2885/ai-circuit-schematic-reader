import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CircuitService } from "./service";
import type { Analysis, SimulinkView } from "./types";

// One shared cache per analysis, so the chat message, the results tabs and the sidebar all see the same
// state, and polling happens once per analysis however many components show it.
interface Entry {
  analysis?: Analysis;
  sim?: SimulinkView;
  error?: string;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const polling = new Map<string, number>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function set(key: string, patch: Partial<Entry>) {
  entries.set(key, { ...entries.get(key), ...patch });
  emit();
}

/** Refetch an analysis from outside a component (after a chat edit or a model build started from chat). */
export async function refreshAnalysis(service: CircuitService, id: string) {
  const key = `${service.mode}:${id}`;
  try {
    const analysis = await service.getAnalysis(id);
    set(key, { analysis, error: undefined });
    if (analysis.simulink.status !== "idle") set(key, { sim: await service.getSimulink(id) });
  } catch (err) {
    set(key, { error: (err as Error).message });
  }
}

const busy = (a?: Analysis) => !!a && (a.status === "queued" || a.status === "running" || a.simulink.status === "running");

export function useAnalysis(service: CircuitService, id: string | null | undefined) {
  const key = id ? `${service.mode}:${id}` : "";
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  const entry = key ? entries.get(key) : undefined;

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const analysis = await service.getAnalysis(id);
      set(key, { analysis, error: undefined });
      if (analysis.simulink.status !== "idle" || entries.get(key)?.sim) {
        set(key, { sim: await service.getSimulink(id) });
      }
    } catch (err) {
      set(key, { error: (err as Error).message });
    }
  }, [id, key, service]);

  const setAnalysis = useCallback((analysis: Analysis) => set(key, { analysis }), [key]);
  const setSim = useCallback((sim: SimulinkView) => set(key, { sim }), [key]);

  useEffect(() => {
    if (!id) return;
    if (!entries.get(key)?.analysis) void refresh();
  }, [id, key, refresh]);

  // Poll while the reader or MATLAB is working; one timer per analysis.
  const isBusy = busy(entry?.analysis);
  useEffect(() => {
    if (!id || !isBusy || polling.has(key)) return;
    const t = window.setInterval(async () => {
      await refresh();
      if (!busy(entries.get(key)?.analysis)) {
        window.clearInterval(polling.get(key));
        polling.delete(key);
      }
    }, service.mode === "demo" ? 400 : 1500);
    polling.set(key, t);
  }, [id, isBusy, key, refresh, service.mode]);

  return { analysis: entry?.analysis, sim: entry?.sim, error: entry?.error, refresh, setAnalysis, setSim };
}
