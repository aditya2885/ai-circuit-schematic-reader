# Schematic Reader: web app

A conversational workspace for the FYP pipeline: upload a circuit schematic (JPG, PNG or PDF), watch the
reader work through it step by step, inspect and edit the result, ask follow-up questions, and generate
the MATLAB/Simulink model.

```
browser (this app) ──> server/app.py (FastAPI) ──> context/schematic-reader/scripts/analyze.py ──> Qwen3-VL (Ollama)
                                         └──────> simulink/ (normalize → generate → MATLAB → check)
```

## Run it

One command serves the API and the built app at <http://127.0.0.1:8000>:

```
python server/app.py
```

For frontend development with hot reload (the dev server proxies `/api` to port 8000):

```
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build into web/dist (served by server/app.py)
```

Node.js is not installed system-wide on this PC; a portable copy is in `tools_node/`. Put it on the PATH first,
e.g. in Git Bash: `export PATH="$PWD/tools_node/node-v22.23.4-win-x64:$PATH"`.

Requirements on the server side: `pip install -r server/requirements.txt`, Ollama running with
`qwen3-vl:8b-instruct` pulled, and MATLAB R2025b with Simscape Electrical for the model build.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_URL` | `web/.env` | API base URL. Empty = same origin (recommended). |
| `SR_API_PROXY` | `web/.env` | Where `npm run dev` forwards `/api` (default `http://127.0.0.1:8000`). |
| `VITE_DEFAULT_MODE` | `web/.env` | `live` or `demo` on first visit. |
| `SR_HOST`, `SR_PORT` | server env | Bind address (default `127.0.0.1:8000`). |
| `SR_CORS_ORIGINS` | server env | Comma-separated allowed origins (default `*`). |
| `SR_DATA_DIR` | server env | Uploads and analyses (default `server_data/`). |

The API URL, vision model, optional box model (e.g. the fine-tuned `qwen3-vl-circuits`), image size and
automatic model generation can also be changed in the app's Settings.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server, Ollama (and its models) and MATLAB status |
| `POST /api/uploads` | Image upload (multipart `file`) → upload id |
| `POST /api/analyses` | Start the schematic analysis of an upload → analysis with live `stages` |
| `GET /api/analyses/{id}` | Status, workflow stages, result, file list |
| `GET`/`PUT /api/analyses/{id}/components` | Extracted components / save edits (rebuilds nets, netlist, BOM) |
| `GET /api/analyses/{id}/connections` | Nets and the pins on each |
| `GET /api/analyses/{id}/netlist` | Netlist text |
| `GET /api/analyses/{id}/bom` | Bill of materials |
| `POST /api/analyses/{id}/simulink` | Generate the MATLAB/Simulink model |
| `GET /api/analyses/{id}/simulink` | Model build / simulation status, check report, results |
| `GET /api/analyses/{id}/files/{name}` | Download a generated file (`.slx`, `.m`, `.json`, `.net.txt`, …) |
| `GET /api/analyses/{id}/bundle.zip` | All files of an analysis |
| `POST /api/chat` | Follow-up conversation (server-sent events) |

Every workflow step the app shows as done was reported done by the pipeline: `analyze.py --progress`
prints a line as each stage starts and ends, and the server maps those to the seven steps.

## Honesty rules built in

- **Confidence** in the components table is the evidence behind each part (traced from the wires, the
  model's reading only, or flagged by the reader), not an invented score.
- Edits ("change R1 to 10 ohms") and model builds requested in chat are carried out by the server, and the
  reply only says they happened after they did. Questions are answered by the vision model with the
  analysis data and image as context.
- **Demo mode** replays two analyses saved from real runs (`server/make_demo.py` builds them). It is
  labelled everywhere, refuses to "analyse" your own uploads, and says when something needs the backend.

## Layout

```
web/src/
  lib/            api.ts (live service), demo.ts (demo service), service.ts (shared interface),
                  store.tsx (conversations, settings), useAnalysis.ts (shared polling cache),
                  actions.ts (analyse / ask / stop), circuit.ts (netlist helpers for demo edits), pdf.ts
  components/
    layout/       Sidebar, Topbar (backend status), SettingsDialog
    chat/         ChatView (welcome + conversation), Composer (upload, PDF, paste, drop), MessageList
    analysis/     Workflow (7 steps), AnalysisMessage
    results/      ResultsPanel + Schematic, Components, Connections, Netlist/BOM, Simulink tabs
    ui/           primitives, ImageViewer (zoom/pan + part boxes), Markdown
```
