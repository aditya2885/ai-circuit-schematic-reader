import type {
  Analysis, AnalysisOptions, ChatEvent, ChatRequest, Component, Health, Mode, SimulinkView, UploadMeta,
} from "./types";

/** Everything the UI asks of a backend. `liveService` calls the Python API; `demoService` replays saved runs. */
export interface CircuitService {
  mode: Mode;
  health(): Promise<Health>;
  /** Image upload endpoint. */
  upload(file: File, sourceName: string, onProgress?: (fraction: number) => void): Promise<UploadMeta>;
  /** Schematic analysis endpoint: starts the reader on an uploaded image. */
  startAnalysis(uploadId: string, options: AnalysisOptions): Promise<Analysis>;
  getAnalysis(id: string): Promise<Analysis>;
  /** Component extraction endpoint (edits): saves components and returns the rebuilt analysis. */
  updateComponents(id: string, components: Component[]): Promise<Analysis>;
  /** Netlist generation endpoint. */
  getNetlist(id: string): Promise<string>;
  /** MATLAB model generation endpoint. */
  startSimulink(id: string): Promise<SimulinkView>;
  /** Simulation status endpoint. */
  getSimulink(id: string): Promise<SimulinkView>;
  /** Opens the built model in the MATLAB desktop on the server's machine and runs it. */
  openInMatlab(id: string): Promise<void>;
  /** Generated file download endpoint. */
  fileUrl(id: string, name: string): string;
  bundleUrl(id: string): string | null;
  chat(req: ChatRequest, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void>;
}

export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}
