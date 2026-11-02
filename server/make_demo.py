"""Build the web app's demo-mode data from saved, real pipeline runs (results/ and simulink/out/).

    python server/make_demo.py

Writes web/public/demo/<name>/analysis.json (the same shape GET /api/analyses/<id> returns, plus the
Simulink view) and copies that run's files next to it. Demo mode replays these saved results and labels
them as such; it never presents them as an analysis of the user's own image.
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import ROOT  # noqa: E402
import circuit  # noqa: E402
from generate import model_name  # noqa: E402
from pipeline import STEPS  # noqa: E402

DEMOS = {"handwritten": "handwritten.jpeg", "inverter": "inverter.png"}
OUT = ROOT / "web" / "public" / "demo"


def build(name: str, image: str) -> dict:
    dest = OUT / name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    src = ROOT / image
    shutil.copy2(src, dest / f"schematic{src.suffix}")
    for suffix in (".json", ".net.txt", ".bom.csv", ".md", ".trace.png"):
        p = ROOT / "results" / f"{name}{suffix}"
        if p.exists():
            shutil.copy2(p, dest / f"schematic{suffix}")
    view = circuit.view(dest)

    sim_dir = ROOT / "simulink" / "out" / name
    sim = json.loads((sim_dir / f"{name}.sim.json").read_text(encoding="utf-8"))
    model = model_name(sim)
    for p in sim_dir.iterdir():
        if p.suffix in (".json", ".txt", ".slx", ".m", ".png"):
            shutil.copy2(p, dest / p.name)
    check = (sim_dir / f"{name}.check.txt").read_text(encoding="utf-8").splitlines()
    results = json.loads((sim_dir / f"{model}.results.json").read_text(encoding="utf-8"))

    comps = view["components"]
    valued = [c for c in comps if c["category"] != "ground"]
    unknown = [c["designator"] for c in valued if c["value"] == "unknown"]
    trace = next((w for w in view["warnings"] if w.startswith("Wire tracing")), "Model wire reading kept.")
    n_fail = sum(x.startswith("FAIL") for x in check)
    details = {
        "image": "Saved run: prepared as the reader does (upright, cleaned, contrast-enhanced).",
        "components": f"{len(comps)} parts",
        "values": f"{len(valued) - len(unknown)} of {len(valued)} values read"
                  + (f"; unreadable: {', '.join(unknown)}" if unknown else ""),
        "connections": trace,
        "reconstruct": "schematic.json, schematic.net.txt",
        "validate": f"{len(view['warnings'])} reader warning(s), {len(sim['issues'])} modelling issue(s), "
                    f"{len(sim['assumed'])} assumed value(s)",
        "simulink": f"{len(sim['parts'])} blocks built and simulated; "
                    f"{sum(x.startswith('PASS') for x in check)} PASS, {n_fail} FAIL",
    }
    status = {k: "done" for k in details}
    if view["warnings"] or sim["issues"]:
        status["validate"] = "warning"
    if n_fail:
        status["simulink"] = "warning"
    warn = [w for w in view["warnings"] if not w.startswith("Wire tracing") or "model's wire reading" in w]
    details["validate"] = (f"{len(warn)} reader warning(s), {len(sim['issues'])} modelling issue(s), "
                           f"{len(sim['assumed'])} assumed value(s)")
    if not warn and not sim["issues"]:
        status["validate"] = "done"
    if "model's wire reading" in trace:
        status["connections"] = "warning"
    validate_log = warn + [f"Simulink: {i}" for i in sim["issues"]] + \
        [f"Simulink default: {a}" for a in sim["assumed"]]
    stages = [{"key": k, "title": t, "description": d, "status": status[k], "detail": details[k],
               "log": validate_log if k == "validate" else [], "started": None, "ended": None}
              for k, t, d in STEPS]

    files = [{"name": p.name, "size": p.stat().st_size,
              "kind": {".json": "data", ".txt": "text", ".csv": "table", ".md": "report", ".slx": "model",
                       ".m": "script"}.get(p.suffix, "image"),
              "origin": "simulink" if p.name.startswith(name) or p.name.startswith("build_") else "reader"}
             for p in sorted(dest.iterdir()) if p.name != "analysis.json"]
    simulink = {
        "status": "done", "error": None, "stale": False, "started": None, "ended": None,
        "phase": "Simulated", "check": check, "log": [], "matlab_available": False, "model": model,
        "assumed": sim["assumed"], "issues": sim["issues"],
        "blocks": [{"id": p["id"], "kind": p["kind"], "value": p.get("value_text", ""), "nets": p["nets"]}
                   for p in sim["parts"]],
        "ground": sim["ground"], "results": results, "preview": (dest / f"{model}.png").exists(),
    }
    analysis = {
        "id": f"demo-{name}", "demo": True, "created": 0, "updated": 0, "status": "done", "error": None,
        "title": view["circuit_type"],
        "file": {"id": f"demo-{name}", "name": image, "size": src.stat().st_size, "width": 0, "height": 0,
                 "type": "image/png" if src.suffix == ".png" else "image/jpeg",
                 "url": f"/demo/{name}/schematic{src.suffix}"},
        "options": {}, "stages": stages, "log": [], "simulink": {k: simulink[k] for k in
                                                               ("status", "error", "stale", "started", "ended",
                                                                "phase", "check", "log")},
        "result": view, "files": files, "matlab_available": False, "simulink_view": simulink,
    }
    (dest / "analysis.json").write_text(json.dumps(analysis, indent=1, ensure_ascii=False), encoding="utf-8")
    return analysis


if __name__ == "__main__":
    for n, img in DEMOS.items():
        a = build(n, img)
        print(n, a["title"], len(a["result"]["components"]), "parts,", len(a["files"]), "files")
