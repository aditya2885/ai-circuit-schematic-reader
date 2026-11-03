// Demo mode: replays analyses saved from real pipeline runs (web/public/demo, built by server/make_demo.py).
// It never analyses the user's own images and never runs a model: every screen in demo mode is labelled,
// and anything that would need the backend says so instead of pretending.
import { applyEdit, BUILD_RE, EDIT_RE, findPart, OPEN_RE, QUESTION_RE, tidyValue } from "./circuit";
import { ApiError, type CircuitService } from "./service";
import { CATEGORIES, type Analysis, type Component, type SimulinkView, type Stage, type UploadMeta } from "./types";

const BASE = import.meta.env.BASE_URL; // "/" locally, "/<repo>/" on GitHub Pages

export const DEMO_SAMPLES = [
  { key: "handwritten", file: "handwritten.jpeg", title: "Hand-drawn RC circuit", subtitle: "Pen sketch · 4 parts · DC check passes", image: `${BASE}demo/handwritten/schematic.jpeg` },
  { key: "inverter", file: "inverter.png", title: "H-bridge inverter", subtitle: "Printed · 10 parts · square-wave check", image: `${BASE}demo/inverter/schematic.png` },
] as const;

type Saved = Analysis & { simulink_view: SimulinkView };

interface DemoRun {
  base: string;
  started: number;
  components: Component[] | null; // user edits; null = as saved
  simRequested: number | null;
}

const STEP_MS = 850;
const cache = new Map<string, Saved>();
const runKey = (id: string) => `sr.demo.${id}`;

async function saved(base: string): Promise<Saved> {
  if (!cache.has(base)) {
    const res = await fetch(`${BASE}demo/${base}/analysis.json`);
    if (!res.ok) throw new ApiError(`Demo data missing: /demo/${base}/analysis.json`);
    const data: Saved = await res.json();
    data.file.url = data.file.url.replace(/^\//, BASE);
    cache.set(base, data);
  }
  return structuredClone(cache.get(base)!);
}

function loadRun(id: string): DemoRun {
  try {
    const raw = localStorage.getItem(runKey(id));
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  throw new ApiError("This demo analysis is no longer available. Open a sample again.", 404);
}

function saveRun(id: string, run: DemoRun) {
  try {
    localStorage.setItem(runKey(id), JSON.stringify(run));
  } catch {
    /* storage unavailable: the run only lasts this session */
  }
}

/** The saved stages, revealed one by one from the moment the sample was opened. */
function replay(stages: Stage[], started: number, simAt: number | null): Stage[] {
  const t = Date.now() - started;
  return stages.map((s, i) => {
    if (s.key === "simulink") {
      const elapsed = simAt === null ? (i <= t / STEP_MS ? 0 : -1) : Date.now() - simAt;
      if (elapsed < 0) return { ...s, status: "pending", detail: "" };
      if (simAt === null) return { ...s, status: "skipped", detail: "Saved model available. Generate it to load the saved build." };
      return elapsed < STEP_MS * 2.5 ? { ...s, status: "running", detail: "Loading the saved MATLAB build (demo)." } : s;
    }
    const at = i * STEP_MS;
    if (t < at) return { ...s, status: "pending", detail: "" };
    if (t < at + STEP_MS) return { ...s, status: "running", detail: "" };
    return s;
  });
}

function simView(saved: Saved, run: DemoRun): SimulinkView {
  const v = saved.simulink_view;
  if (run.simRequested === null) return { ...v, status: "idle", check: [], results: null, preview: false };
  if (Date.now() - run.simRequested < STEP_MS * 2.5)
    return { ...v, status: "running", phase: "Loading the saved MATLAB build (demo)", check: [], results: null, preview: false };
  return { ...v, stale: run.components !== null };
}

async function view(id: string): Promise<Analysis> {
  const run = loadRun(id);
  const s = await saved(run.base);
  const stages = replay(s.stages, run.started, run.simRequested);
  const busy = stages.some((st) => st.status === "running" && st.key !== "simulink");
  let result = s.result;
  if (result && run.components) result = applyEdit(result, run.components, s.file.name);
  const sim = simView(s, run);
  return {
    ...s,
    id,
    status: busy || stages.every((st) => st.status === "pending") ? "running" : "done",
    stages,
    result: busy ? null : result,
    simulink: { status: sim.status, error: sim.error, stale: sim.stale, started: null, ended: null, phase: sim.phase, check: sim.check, log: [] },
  };
}

export function demoService(): CircuitService {
  return {
    mode: "demo",

    async health() {
      return { ok: true, version: "demo", ollama: { ok: false, models: [], error: "Demo mode" }, matlab: { ok: false, path: "" } };
    },

    async upload(file, sourceName): Promise<UploadMeta> {
      // Kept in the browser only, so the preview works; demo mode cannot analyse it.
      return { id: `local-${crypto.randomUUID().slice(0, 8)}`, name: sourceName, size: file.size, width: 0, height: 0, type: file.type, url: URL.createObjectURL(file) };
    },

    async startAnalysis(uploadId) {
      const base = uploadId.startsWith("demo-") ? uploadId.slice(5) : null;
      if (!base || !DEMO_SAMPLES.some((d) => d.key === base))
        throw new ApiError("Demo mode replays saved sample analyses and cannot read your own image. Switch to Live mode in Settings (with the Python server running) to analyse it.");
      const id = `demo-${base}-${crypto.randomUUID().slice(0, 8)}`;
      saveRun(id, { base, started: Date.now(), components: null, simRequested: null });
      return view(id);
    },

    getAnalysis: view,

    async updateComponents(id, components) {
      const run = loadRun(id);
      run.components = components.map(({ evidence: _e, ...c }) => c as Component);
      saveRun(id, run);
      return view(id);
    },

    async getNetlist(id) {
      return (await view(id)).result?.netlist ?? "";
    },

    async startSimulink(id) {
      const run = loadRun(id);
      if (run.components !== null)
        throw new ApiError("Demo mode cannot run MATLAB, so it cannot build a model from your edits. The saved model was built from the original reading. Switch to Live mode to rebuild.");
      run.simRequested = Date.now();
      saveRun(id, run);
      return simView(await saved(run.base), run);
    },

    async getSimulink(id) {
      const run = loadRun(id);
      return simView(await saved(run.base), run);
    },

    fileUrl(id, name) {
      return `${BASE}demo/${id.split("-")[1]}/${encodeURIComponent(name)}`;
    },

    bundleUrl: () => null,

    async openInMatlab() {
      throw new ApiError("Demo mode cannot open MATLAB. Run Start-SchematicReader.bat on your PC and switch to Live mode to open the model in MATLAB.");
    },

    async chat(req, onEvent) {
      const id = req.analysis_id;
      const a = id ? await view(id).catch(() => null) : null;
      const comps = a?.result?.components ?? [];
      const edit = id && a?.result ? EDIT_RE.exec(req.message) : null;
      const part = edit ? findPart(edit[1], comps) : null;
      if (id && edit && part) {
        const raw = edit[2].trim().replace(/^["']|["']$/g, "");
        const cat = raw.toLowerCase().replace(/^an? /, "").trim().replace(/ /g, "_");
        const isCat = (CATEGORIES as readonly string[]).includes(cat);
        const field = isCat ? "category" : "value";
        const next = isCat ? cat : tidyValue(raw);
        const old = isCat ? part.category : part.value;
        const updated = comps.map(({ evidence: _e, ...c }) => (c.designator === part.designator ? { ...c, [field]: next } : c)) as Component[];
        await this.updateComponents(id, updated);
        onEvent({ type: "action", action: "edit", designator: part.designator, field, old, new: next });
        onEvent({ type: "token", text: `Updated **${part.designator}** ${field} from \`${old}\` to \`${next}\`. The netlist, connections and bill of materials were regenerated (in your browser: demo mode).` });
      } else if (id && a?.result && OPEN_RE.test(req.message) && !QUESTION_RE.test(req.message)) {
        onEvent({ type: "error", message: "Demo mode cannot open MATLAB. Run Start-SchematicReader.bat on your PC; this page then switches to Live and can open the model in MATLAB." });
      } else if (id && a?.result && BUILD_RE.test(req.message) && !QUESTION_RE.test(req.message)) {
        try {
          await this.startSimulink(id);
          onEvent({ type: "action", action: "simulink", status: "started" });
          onEvent({ type: "token", text: "Loading the **saved** MATLAB/Simulink build of this sample (demo mode does not run MATLAB). It appears in the **MATLAB/Simulink** tab." });
        } catch (err) {
          onEvent({ type: "error", message: (err as Error).message });
        }
      } else {
        const summary = a?.result ? `\n\n**Saved analysis of this sample:** ${a.result.summary}` : "";
        onEvent({ type: "token", text: `**Demo mode:** answers to questions come from the vision model, which needs the live backend (Python server + Ollama). Switch to **Live** in Settings to ask about a circuit. Edits ("change R1 to 10 ohms") and loading the saved Simulink model work here.${summary}` });
      }
      onEvent({ type: "done" });
    },
  };
}
