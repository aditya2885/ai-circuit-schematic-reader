// Shapes returned by the Python API (server/app.py). Demo mode returns the same shapes from saved runs.

export type StepStatus = "pending" | "running" | "done" | "warning" | "error" | "skipped";

export interface Stage {
  key: string;
  title: string;
  description: string;
  status: StepStatus;
  detail: string;
  log: string[];
  started: number | null;
  ended: number | null;
}

export interface Pin {
  pin: string;
  net: string;
}

export interface Evidence {
  level: "traced" | "model" | "check";
  reasons: string[];
  corrections: string[];
}

export const CATEGORIES = [
  "resistor", "capacitor", "inductor", "diode", "led", "transistor", "mosfet", "thyristor", "ic",
  "connector", "crystal", "fuse", "switch", "battery", "voltage_source", "current_source", "lamp",
  "meter", "ground", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Component {
  designator: string;
  category: Category;
  value: string;
  part_number: string;
  role: string;
  pins: Pin[];
  evidence?: Evidence | null;
}

export interface Connection {
  net: string;
  members: { designator: string; pin: string }[];
  flags: string[];
}

export interface BomRow {
  category: string;
  value: string;
  part_number: string;
  quantity: number;
  designators: string[];
}

export interface Layout {
  size: [number, number];
  parts: Record<string, { x: number; y: number; w: number; h: number }>;
}

export interface CircuitResult {
  circuit_type: string;
  summary: string;
  drawing_style: string;
  confidence: string;
  topology: string;
  design_notes: string[];
  unreadable: string[];
  components: Component[];
  connections: Connection[];
  warnings: string[];
  netlist: string;
  bom: BomRow[];
  layout?: Layout | null;
  edited: boolean;
  tracing_used: boolean;
}

export interface FileEntry {
  name: string;
  size: number;
  kind: string;
  origin: "reader" | "simulink";
}

export interface UploadMeta {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  type: string;
  url: string;
}

export interface SimulinkState {
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  stale: boolean;
  started: number | null;
  ended: number | null;
  phase: string;
  check: string[];
  log: string[];
}

export interface SimResults {
  ok: boolean;
  error: string;
  nodes: { name: string; final: number; min: number; max: number }[];
  parts: { name: string; v_final: number; v_min: number; v_max: number; i_final: number; i_min: number; i_max: number }[];
}

/** Node voltages over time, from MATLAB's simulation (at most 800 samples). */
export interface Waveforms {
  t: number[];
  series: { name: string; unit: string; y: number[] }[];
}

export interface SimulinkView extends SimulinkState {
  matlab_available: boolean;
  model: string;
  assumed: string[];
  issues: string[];
  blocks: { id: string; kind: string; value: string; nets: string[] }[];
  ground: string | null;
  results: SimResults | null;
  preview: boolean;
  waveforms?: Waveforms | null;
}

export type AnalysisStatus = "queued" | "running" | "done" | "error" | "rejected";

export interface Analysis {
  id: string;
  demo?: boolean;
  created: number;
  updated: number;
  status: AnalysisStatus;
  error: string | null;
  title: string;
  file: UploadMeta;
  options: Record<string, unknown>;
  stages: Stage[];
  log: string[];
  simulink: SimulinkState;
  result: CircuitResult | null;
  files: FileEntry[];
  matlab_available: boolean;
}

export interface Health {
  ok: boolean;
  version: string;
  ollama: { ok: boolean; models: string[]; error: string | null };
  matlab: { ok: boolean; path: string };
  /** True when this browser reaches the server through the public tunnel (not on the server PC). */
  remote?: boolean;
}

export interface AnalysisOptions {
  model: string;
  box_model: string | null;
  max_side: number;
  simulink: boolean;
}

export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "action"; action: "edit"; designator: string; field: string; old: string; new: string }
  | { type: "action"; action: "simulink"; status: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatRequest {
  message: string;
  analysis_id: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
}

// ---------------------------------------------------------------- client-side conversation state

export type Mode = "live" | "demo";

export interface Attachment {
  name: string; // what the user picked, e.g. "amp.pdf"
  size: number;
  url: string; // where the image can be shown from (server or demo asset)
  uploadId: string | null;
  width?: number;
  height?: number;
  fromPdf?: boolean;
}

export type MessageKind = "text" | "analysis" | "action" | "error";

export interface Message {
  id: string;
  role: "user" | "assistant";
  kind: MessageKind;
  text: string;
  created: number;
  attachments?: Attachment[];
  analysisId?: string;
  streaming?: boolean;
  action?: { label: string; detail?: string; tone?: "ok" | "info" | "warn" };
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  saved: boolean;
  mode: Mode;
  analysisId: string | null;
  messages: Message[];
}

export interface Settings {
  mode: Mode;
  apiUrl: string;
  model: string;
  boxModel: string;
  maxSide: number;
  autoSimulink: boolean;
  theme: "dark" | "light";
  userName: string;
}
