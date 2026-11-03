"""Analysis and Simulink jobs.

An analysis runs the reader (analyze.py --progress) on one uploaded image in its own folder,
server_data/analyses/<id>/. Each '@@stage' line the reader prints moves the matching workflow step, so
every step the web app shows as done was reported done by the pipeline itself. A Simulink job runs the
builder's own normalize/generate/check functions and MATLAB, into simulink/out/web_<id>/.

Job state is kept in <folder>/job.json so it survives a server restart.
"""
import json
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from paths import ANALYSES, READER_SCRIPTS, ROOT, UPLOADS
import circuit
from build_simulink import MATLAB, OUT as SIM_OUT, check
from generate import matlab_script, model_name
from normalize import normalize

STEPS = [
    ("image", "Image processing", "Preparing the schematic: upright, ruled lines removed, cropped and contrast-enhanced."),
    ("components", "Component detection", "Identifying resistors, capacitors, inductors, diodes, transistors, switches and sources."),
    ("values", "Value extraction", "Reading component values and labels."),
    ("connections", "Connection detection", "Finding which wires join which terminals."),
    ("reconstruct", "Circuit reconstruction", "Building nets and the structured circuit description."),
    ("validate", "Validation", "Checking for missing values, ambiguous connections and possible errors."),
    ("simulink", "MATLAB model generation", "Building the Simulink/Simscape model and simulating it."),
]

_analysis_lock = threading.Semaphore(1)   # one image at a time: the model runs on one GPU
_matlab_lock = threading.Semaphore(1)
_state_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def now() -> float:
    return round(time.time(), 3)


def folder(job_id: str) -> Path:
    return ANALYSES / job_id


def sim_folder(job_id: str) -> Path:
    return SIM_OUT / f"web_{job_id}"


def matlab_available() -> bool:
    return Path(MATLAB).exists()


def _save(job: dict) -> None:
    (folder(job["id"]) / "job.json").write_text(json.dumps(job, indent=2), encoding="utf-8")


def get(job_id: str) -> dict | None:
    with _state_lock:
        if job_id in _jobs:
            return json.loads(json.dumps(_jobs[job_id]))
    p = folder(job_id) / "job.json"
    if not p.exists():
        return None
    job = json.loads(p.read_text(encoding="utf-8"))
    with _state_lock:
        _jobs[job_id] = job
    return json.loads(json.dumps(job))


def _update(job_id: str, fn) -> None:
    with _state_lock:
        job = _jobs[job_id]
        fn(job)
        job["updated"] = now()
        _save(job)


def _step(job: dict, key: str) -> dict:
    return next(s for s in job["stages"] if s["key"] == key)


def _set(job: dict, key: str, status: str, detail: str | None = None) -> None:
    s = _step(job, key)
    if status == "running" and s["started"] is None:
        s["started"] = now()
    if status in ("done", "warning", "error", "skipped"):
        s["started"] = s["started"] or now()
        s["ended"] = now()
    s["status"] = status
    if detail is not None:
        s["detail"] = detail


def list_jobs() -> list[dict]:
    out = []
    for p in sorted(ANALYSES.glob("*/job.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        job = get(p.parent.name)
        if job:
            out.append({k: job[k] for k in ("id", "created", "status", "file")} | {"title": job.get("title", "")})
    return out


def recover() -> None:
    """Jobs left running by a stopped server can never finish: mark them failed."""
    for p in ANALYSES.glob("*/job.json"):
        job = json.loads(p.read_text(encoding="utf-8"))
        changed = False
        if job["status"] in ("queued", "running"):
            job["status"], job["error"] = "error", "The server stopped during this analysis. Run it again."
            for s in job["stages"]:
                if s["status"] == "running":
                    s["status"], s["ended"] = "error", now()
            changed = True
        if job.get("simulink", {}).get("status") == "running":
            job["simulink"].update(status="error", error="The server stopped while building the model.")
            _set(job, "simulink", "error", "Interrupted by a server restart.")
            changed = True
        if changed:
            p.write_text(json.dumps(job, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- analysis

def start_analysis(upload_id: str, options: dict) -> dict:
    src = next((p for p in UPLOADS.glob(f"{upload_id}.*") if p.suffix != ".json"), None)
    meta_p = UPLOADS / f"{upload_id}.meta.json"
    if src is None or not meta_p.exists():
        raise FileNotFoundError(upload_id)
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    job_id = uuid.uuid4().hex[:12]
    f = folder(job_id)
    f.mkdir(parents=True)
    shutil.copy2(src, f / f"{circuit.STEM}{src.suffix.lower()}")
    job = {
        "id": job_id, "created": now(), "updated": now(), "status": "queued", "error": None, "title": "",
        "file": meta, "options": options,
        "stages": [{"key": k, "title": t, "description": d, "status": "pending", "detail": "", "log": [],
                    "started": None, "ended": None} for k, t, d in STEPS],
        "log": [],
        "simulink": {"status": "idle", "error": None, "stale": False, "started": None, "ended": None,
                     "phase": "", "check": [], "log": []},
    }
    with _state_lock:
        _jobs[job_id] = job
        _save(job)
    threading.Thread(target=_run_analysis, args=(job_id,), daemon=True).start()
    return get(job_id)


# reader stage -> (workflow steps it moves, status for those steps)
def _on_marker(job: dict, m: dict) -> None:
    st, status, detail = m["stage"], m["status"], m.get("detail", "")
    if st == "prepare":
        _set(job, "image", status, detail or None)
        if status == "error":
            job["status"], job["error"] = "rejected", detail
    elif st == "read":
        if status == "running":
            _set(job, "components", "running", "Reading the drawing with the vision model.")
            _set(job, "values", "running", "Values are read in the same model pass as the parts.")
        elif status == "done":
            _step(job, "components")["detail"] = f"{detail} read; looking again for parts the first answer missed."
        else:
            _set(job, "components", "error", detail)
            _set(job, "values", "error", detail)
    elif st == "recheck" and status == "done":
        _set(job, "components", "done", detail)
        _set(job, "values", "done")
    elif st in ("fix", "trace") and status == "running":
        for k in ("components", "values"):
            if _step(job, k)["status"] == "running":
                _set(job, k, "done")
        _set(job, "connections", "running",
             "Asking the model to fix connectivity problems." if st == "fix" else
             "Tracing wires from the pixels between the located part boxes.")
    elif st == "trace" and status == "done":
        # The tracer could not confirm the wiring: the connections are the model's reading only.
        fallback = not detail or "using the model's wire reading" in detail
        _set(job, "connections", "warning" if fallback else "done", detail or "Model wire reading kept.")
        _set(job, "reconstruct", "running")
    elif st == "write" and status == "done":
        if _step(job, "reconstruct")["status"] == "pending":   # tracing was off: no trace marker came
            _set(job, "reconstruct", "running")
        if _step(job, "connections")["status"] == "running":
            _set(job, "connections", "done")
        _set(job, "reconstruct", "done", detail)


def _current_step(job: dict) -> dict | None:
    running = [s for s in job["stages"] if s["status"] == "running"]
    return running[-1] if running else None


def _run_analysis(job_id: str) -> None:
    with _analysis_lock:
        _update(job_id, lambda j: j.update(status="running"))
        job = get(job_id)
        opts = job["options"]
        f = folder(job_id)
        img = next(p for p in f.iterdir() if p.stem == circuit.STEM and p.suffix != ".json")
        cmd = [sys.executable, "-u", str(READER_SCRIPTS / "analyze.py"), str(img), "--out", str(f),
               "--progress", "--md", "--csv", "--model", opts.get("model") or "qwen3-vl:8b-instruct",
               "--max-side", str(int(opts.get("max_side") or 1600))]
        if opts.get("box_model"):
            cmd += ["--box-model", opts["box_model"]]
        try:
            proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    encoding="utf-8", errors="replace", bufsize=1)
        except OSError as err:
            _update(job_id, lambda j: j.update(status="error", error=f"Could not start the reader: {err}"))
            return
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue

            def apply(j, line=line):
                if line.startswith("@@stage "):
                    _on_marker(j, json.loads(line[8:]))
                    return
                text = line.strip()
                j["log"].append(text)
                step = _current_step(j)
                if step is not None and not text.startswith("["):
                    step["log"].append(text)
            _update(job_id, apply)
        code = proc.wait()

    job = get(job_id)
    if job["status"] == "rejected":
        return
    report = circuit.load(f)
    if code != 0 or report is None:
        tail = "\n".join(job["log"][-6:])

        def fail(j):
            j["status"], j["error"] = "error", tail or f"The reader exited with code {code}."
            step = _current_step(j)
            if step is None and not any(s["status"] == "error" for s in j["stages"]):
                step = next((s for s in j["stages"] if s["status"] == "pending"), None)
            if step:
                _set(j, step["key"], "error", "Failed; see the log.")
        _update(job_id, fail)
        return

    _validate(job_id, report)
    auto = job["options"].get("simulink", True)
    if auto and matlab_available():
        start_simulink(job_id)
    else:
        _update(job_id, lambda j: _set(j, "simulink", "skipped",
                                       "MATLAB was not found on this machine." if auto else
                                       "Not started. Generate the model when the circuit looks right."))


def _validate(job_id: str, report: dict) -> None:
    """Step 6: the reader's warnings plus what the Simulink normaliser would assume or leave out."""
    def apply(j):
        _set(j, "validate", "running")
        comps = report.get("components", [])
        unknown = [c["designator"] for c in comps if c.get("value") == "unknown" and c["category"] != "ground"]
        valued = [c for c in comps if c["category"] != "ground"]
        _set(j, "values", "done", f"{len(valued) - len(unknown)} of {len(valued)} values read"
                                  + (f"; unreadable: {', '.join(unknown)}" if unknown else ""))
        sim = normalize(report, f"web_{job_id}", "auto")
        # The tracer's summary line is a note when tracing worked, a warning only when it fell back.
        warnings = [w for w in report.get("connectivity_warnings", [])
                    if not w.startswith("Wire tracing") or "model's wire reading" in w]
        lines = warnings + [f"Simulink: {i}" for i in sim["issues"]] + [f"Simulink default: {a}" for a in sim["assumed"]]
        _step(j, "validate")["log"] = lines
        n = len(warnings) + len(sim["issues"])
        _set(j, "validate", "warning" if n else "done",
             f"{len(warnings)} reader warning(s), {len(sim['issues'])} modelling issue(s), "
             f"{len(sim['assumed'])} assumed value(s)" if lines else "No problems found.")
        j["status"], j["title"] = "done", report.get("circuit_type", "")
    _update(job_id, apply)


# ---------------------------------------------------------------- Simulink

def start_simulink(job_id: str) -> dict:
    job = get(job_id)
    if job is None:
        raise FileNotFoundError(job_id)
    if job["simulink"]["status"] == "running":
        raise RuntimeError("A model is already being built for this analysis.")
    if circuit.load(folder(job_id)) is None:
        raise RuntimeError("There is no circuit to build yet.")
    if not matlab_available():
        raise RuntimeError(f"MATLAB was not found at {MATLAB}.")

    def apply(j):
        j["simulink"].update(status="running", error=None, stale=False, started=now(), ended=None,
                             phase="Normalising the circuit", check=[], log=[])
        s = _step(j, "simulink")
        s.update(started=None, ended=None, log=[])
        _set(j, "simulink", "running", "Normalising the circuit for Simscape.")
    _update(job_id, apply)
    threading.Thread(target=_run_simulink, args=(job_id,), daemon=True).start()
    return get(job_id)


def _run_simulink(job_id: str) -> None:
    def phase(text, log=None):
        def apply(j):
            j["simulink"]["phase"] = text
            _step(j, "simulink")["detail"] = text
            if log:
                j["simulink"]["log"] += log
                _step(j, "simulink")["log"] += log
        _update(job_id, apply)

    def fail(msg):
        def apply(j):
            j["simulink"].update(status="error", error=msg, ended=now())
            _set(j, "simulink", "error", msg.splitlines()[0][:200])
        _update(job_id, apply)

    try:
        report = circuit.load(folder(job_id))
        sim = normalize(report, f"web_{job_id}", "auto")
        out = sim_folder(job_id)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{sim['name']}.sim.json").write_text(json.dumps(sim, indent=2, ensure_ascii=False), encoding="utf-8")
        script = out / f"build_{sim['name']}.m"
        script.write_text(matlab_script(sim), encoding="utf-8")
        notes = [f"assumed: {a}" for a in sim["assumed"]] + [f"ISSUE: {i}" for i in sim["issues"]]
        if not sim["parts"]:
            fail("No part of this circuit can be modelled in Simscape yet.")
            return
        phase(f"{len(sim['parts'])} blocks; waiting for MATLAB", notes)
        with _matlab_lock:
            phase("MATLAB is building and simulating the model (this takes a minute or two)")
            model = model_name(sim)
            slx, png = (out / f"{model}.slx").as_posix(), (out / f"{model}.png").as_posix()
            batch = (f"run('{script.as_posix()}'); "
                     f"try, load_system('{slx}'); print('-s{model}', '-dpng', '-r110', '{png}'); "
                     f"close_system('{model}', 0); catch e, disp(['preview: ' e.message]); end")
            proc = subprocess.run([MATLAB, "-batch", batch], capture_output=True, text=True, cwd=out)
        if proc.returncode != 0:
            fail(f"MATLAB failed:\n{(proc.stdout + proc.stderr)[-3000:]}")
            return
        res_p = out / f"{model}.results.json"
        if not res_p.exists():
            fail("MATLAB finished but wrote no results file.")
            return
        lines = check(sim, json.loads(res_p.read_text(encoding="utf-8")))
        (out / f"{sim['name']}.check.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        failed = any(line.startswith("FAIL") for line in lines)

        def done(j):
            j["simulink"].update(status="done", ended=now(), check=lines,
                                 phase="Simulated" + (" with failures" if failed else ""))
            _set(j, "simulink", "warning" if failed else "done",
                 f"{len(sim['parts'])} blocks built and simulated; "
                 f"{sum(x.startswith('PASS') for x in lines)} PASS, {sum(x.startswith('FAIL') for x in lines)} FAIL")
        _update(job_id, done)
    except Exception as err:   # report any builder error to the user instead of leaving the job running
        fail(f"{type(err).__name__}: {err}")


def simulink_view(job_id: str) -> dict:
    job = get(job_id)
    out = sim_folder(job_id)
    sim_p = out / f"web_{job_id}.sim.json"
    sim = json.loads(sim_p.read_text(encoding="utf-8")) if sim_p.exists() else None
    model = model_name(sim) if sim else f"web_{job_id}_sim"
    res_p = out / f"{model}.results.json"
    return job["simulink"] | {
        "matlab_available": matlab_available(),
        "model": model,
        "assumed": sim["assumed"] if sim else [],
        "issues": sim["issues"] if sim else [],
        "blocks": [{"id": p["id"], "kind": p["kind"], "value": p.get("value_text", ""), "nets": p["nets"]}
                   for p in sim["parts"]] if sim else [],
        "ground": sim["ground"] if sim else None,
        "results": json.loads(res_p.read_text(encoding="utf-8")) if res_p.exists() else None,
        "preview": (out / f"{model}.png").exists(),
    }


def open_in_matlab(job_id: str) -> str:
    """Open the built model in the MATLAB desktop and run it, so the user sees it (the build itself runs
    MATLAB hidden, with -batch). MATLAB stays open afterwards; the scope shows the node voltages."""
    job = get(job_id)
    if job is None:
        raise FileNotFoundError(job_id)
    if not matlab_available():
        raise RuntimeError(f"MATLAB was not found at {MATLAB}.")
    if job["simulink"]["status"] != "done":
        raise RuntimeError("Generate the model first; there is no built model to open yet.")
    out = sim_folder(job_id)
    model = f"web_{job_id}_sim"
    slx = (out / f"{model}.slx").as_posix()
    if not Path(slx).exists():
        raise RuntimeError("The model file is missing; rebuild the model.")
    cmd = (f"cd('{out.as_posix()}'); open_system('{slx}'); "
           f"try, open_system('{model}/Node voltages'); catch, end; "
           f"set_param('{model}', 'SimulationCommand', 'start');")
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen([MATLAB, "-logfile", str(out / "matlab_open.log"), "-r", cmd], cwd=out,
                     creationflags=flags, close_fds=True)
    return model


def mark_stale(job_id: str) -> None:
    def apply(j):
        if j["simulink"]["status"] in ("done", "error"):
            j["simulink"]["stale"] = True
    _update(job_id, apply)


def files(job_id: str) -> list[dict]:
    """Downloadable files: the reader's outputs and the Simulink model, never anything outside those folders."""
    kinds = {".json": "data", ".txt": "text", ".csv": "table", ".md": "report", ".png": "image", ".jpg": "image",
             ".jpeg": "image", ".webp": "image", ".bmp": "image", ".slx": "model", ".m": "script"}
    out = []
    for base, origin in ((folder(job_id), "reader"), (sim_folder(job_id), "simulink")):
        if base.exists():
            for p in sorted(base.iterdir()):
                if p.is_file() and p.name != "job.json" and p.suffix.lower() in kinds:
                    out.append({"name": p.name, "size": p.stat().st_size, "kind": kinds[p.suffix.lower()],
                                "origin": origin})
    return out


def file_path(job_id: str, name: str) -> Path | None:
    if "/" in name or "\\" in name or name.startswith(".") or name == "job.json":
        return None
    for base in (folder(job_id), sim_folder(job_id)):
        p = base / name
        if p.is_file():
            return p
    return None
