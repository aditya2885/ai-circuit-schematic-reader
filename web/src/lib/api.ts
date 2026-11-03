import { ApiError, type CircuitService } from "./service";
import type { Analysis, ChatEvent, Component, Health, SimulinkView, UploadMeta } from "./types";

/** Base URL of the Python API. Empty means same origin (Vite proxies /api in development). */
/** The app as served by the analysis server on this PC (Start-SchematicReader.bat): always Live. */
export const LIVE_APP = "http://127.0.0.1:8000/";

/** Where Start-Public.bat publishes the current public address of the analysis server (GitHub API, fresh). */
const DISCOVERY_URL = import.meta.env.VITE_BACKEND_DISCOVERY as string | undefined;

/** The public analysis server, if one is running and answering now; null otherwise. */
export async function discoverPublicBackend(): Promise<string | null> {
  if (!DISCOVERY_URL) return null;
  try {
    const res = await fetch(DISCOVERY_URL, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json" } });
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url?: string | null };
    if (!url || !/^https:\/\//.test(url)) return null;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 6000);
    try {
      const health = await fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: ctrl.signal, cache: "no-store" });
      return health.ok ? url.replace(/\/$/, "") : null;
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export const ENV_API_URL =(import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch {
    throw new ApiError("Cannot reach the analysis server. Start it with: python server/app.py", 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function liveService(baseUrl: string): CircuitService {
  const base = baseUrl.replace(/\/$/, "");
  // The server returns same-origin paths for images; prefix them when the API lives elsewhere.
  const abs = (a: Analysis): Analysis => ({ ...a, file: { ...a.file, url: base + a.file.url } });
  return {
    mode: "live",

    health: () => request<Health>(base, "/api/health"),

    upload(file, sourceName, onProgress) {
      // XMLHttpRequest, because fetch cannot report upload progress.
      return new Promise<UploadMeta>((resolve, reject) => {
        const form = new FormData();
        form.append("file", file);
        form.append("source_name", sourceName);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${base}/api/uploads`);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onload = () => {
          let body: { detail?: string } & Partial<UploadMeta> = {};
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            /* empty */
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve({ ...(body as UploadMeta), url: base + body.url });
          else reject(new ApiError(body.detail || `Upload failed (${xhr.status})`, xhr.status));
        };
        xhr.onerror = () => reject(new ApiError("Cannot reach the analysis server. Start it with: python server/app.py"));
        xhr.send(form);
      });
    },

    startAnalysis: (uploadId, o) =>
      request<Analysis>(base, "/api/analyses", json({ upload_id: uploadId, ...o })).then(abs),

    getAnalysis: (id) => request<Analysis>(base, `/api/analyses/${id}`).then(abs),

    updateComponents: (id, components: Component[]) =>
      request<Analysis>(base, `/api/analyses/${id}/components`, {
        ...json({ components }),
        method: "PUT",
      }).then(abs),

    getNetlist: (id) => request<string>(base, `/api/analyses/${id}/netlist`),

    startSimulink: (id) => request<SimulinkView>(base, `/api/analyses/${id}/simulink`, { method: "POST" }),

    getSimulink: (id) => request<SimulinkView>(base, `/api/analyses/${id}/simulink`),

    openInMatlab: (id) => request<void>(base, `/api/analyses/${id}/simulink/open`, { method: "POST" }),

    fileUrl: (id, name) => `${base}/api/analyses/${id}/files/${encodeURIComponent(name)}`,

    bundleUrl: (id) => `${base}/api/analyses/${id}/bundle.zip`,

    async chat(req, onEvent, signal) {
      let res: Response;
      try {
        res = await fetch(`${base}/api/chat`, { ...json(req), signal });
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        throw new ApiError("Cannot reach the analysis server. Start it with: python server/app.py");
      }
      if (!res.ok || !res.body) throw new ApiError(`Chat failed (${res.status})`, res.status);
      // Server-sent events: one JSON object per "data:" line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 2);
          if (chunk.startsWith("data:")) onEvent(JSON.parse(chunk.slice(5)) as ChatEvent);
        }
      }
    },
  };
}
