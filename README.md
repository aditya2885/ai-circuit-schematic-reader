# AI Circuit Schematic Reader

**Website: https://aditya2885.github.io/ai-circuit-schematic-reader/**

Upload a photo or scan of a circuit schematic, printed or hand-drawn. A local vision model (Qwen3-VL via
Ollama) reads every part, value and label, the wire tracer confirms the connections from the pixels, and the
result becomes an editable netlist, a bill of materials and a MATLAB Simulink/Simscape model that is built,
simulated and checked against an independent hand calculation.

```
image ─> analyze.py (Qwen3-VL + wire tracing) ─> circuit JSON / netlist / BOM ─> simulink builder ─> .slx, simulated and checked
                     └────────────── server/app.py (FastAPI) ── web app (React) ──────────────┘
```

## Use the website

- **While the analysis PC is online** (`Start-Public.bat` running on it), anyone who opens the link gets
  **Live** mode: upload a JPG, PNG or PDF, watch the seven processing steps, edit the components, ask questions
  ("explain how this circuit works"), give instructions ("change R1 to 10 ohms", "generate the MATLAB model"),
  and download the netlist, BOM, `.slx` model and every generated file.
- **Otherwise** the site runs in *demo mode*: it replays two analyses saved from real runs, clearly labelled.

## Run the analysis PC

1. Install [Python 3.11+](https://www.python.org/downloads/), [Ollama](https://ollama.com) and, for the
   Simulink step, MATLAB R2025b with Simscape Electrical. Then `ollama pull qwen3-vl:8b-instruct`.
2. Download this repository (green **Code** button, *Download ZIP*) and unzip it.
3. Double-click **`Start-Public.bat`** to make the website Live for everyone. It starts the server, opens a
   Cloudflare tunnel to it and publishes the tunnel's address for the website. Press Enter in its window to
   stop sharing. (It needs a one-time GitHub sign-in: `github-login.bat`.)
4. Or double-click **`Start-SchematicReader.bat`** for private use on this PC only (http://127.0.0.1:8000).
   Only here does **Open in MATLAB** open the model on screen; remote visitors download the `.slx` instead.

## Repository

| Folder | What it is |
|---|---|
| `context/schematic-reader/` | The reader: image preparation, Qwen3-VL prompts and schema, wire tracing, netlist |
| `simulink/` | Circuit JSON → Simscape model (MATLAB script), simulation, and the hand-calculation check |
| `server/` | FastAPI server for the website: uploads, analysis jobs, edits, chat, model builds, downloads |
| `web/` | The website (React, TypeScript, Tailwind). See `web/README.md` for the API and development |
| `training/` | QLoRA fine-tune of Qwen3-VL on the CGHD dataset for symbol boxes (Kaggle notebook) |

Command line, without the website: `python context/schematic-reader/scripts/analyze.py circuit.png --md --csv`,
then `python simulink/build_simulink.py circuit.json --run`.

## Publishing updates

Double-click `deploy.bat`: it lists the files, asks for approval, signs in to GitHub through the browser,
pushes the code and rebuilds the website.
