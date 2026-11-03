#!/usr/bin/env python3
"""Schematic reader JSON -> Simulink/Simscape model, with every read value entered.

    python simulink/build_simulink.py results/handwritten.json            # write .sim.json + build script
    python simulink/build_simulink.py results/handwritten.json --run      # also build .slx and simulate
    python simulink/build_simulink.py simulink/out/handwritten/handwritten.sim.json --run   # after editing

Outputs go to simulink/out/<name>/: <name>.sim.json (editable), build_<name>.m, <name>.slx,
<name>.results.json, and a check of the simulated values against an independent hand calculation.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dcsolve import LINEAR, solve_dc  # noqa: E402
from generate import matlab_script, model_name, safe  # noqa: E402
from normalize import normalize  # noqa: E402

MATLAB = r"C:\Program Files\MATLAB\R2025b\bin\matlab.exe"
OUT = Path(__file__).resolve().parent / "out"


def check(sim: dict, res: dict) -> list[str]:
    """Compare simulated values with what the circuit should do. Returns report lines (PASS/FAIL/INFO)."""
    lines = []
    if not res.get("ok"):
        return [f"FAIL simulation error: {res.get('error')}"]
    nodes = {n["name"]: n for n in _list(res.get("nodes"))}
    parts = {p["name"]: p for p in _list(res.get("parts"))}
    expected = solve_dc(sim)
    # A non-linear part (lamp, diode) sitting directly across an ideal voltage source cannot change any
    # node voltage, so the linear rest of the circuit can still be checked exactly without it.
    sources = [set(p["nets"][:2]) for p in sim["parts"] if p["kind"] == "dc_voltage"]
    pinned = [p for p in sim["parts"] if p["kind"] not in LINEAR and set(p["nets"][:2]) in sources]
    if expected is None and pinned and len(pinned) == sum(p["kind"] not in LINEAR for p in sim["parts"]):
        expected = solve_dc(sim | {"parts": [p for p in sim["parts"] if p not in pinned]})
        lines.append(f"INFO {', '.join(p['id'] for p in pinned)} sit across the source; checked without them")
    if expected is not None:
        for net, v in sorted(expected.items()):
            if net == sim["ground"] or net not in nodes:
                continue
            got = nodes[net]["final"]
            ok = abs(got - v) <= max(1e-3, 0.01 * abs(v))
            lines.append(f"{'PASS' if ok else 'FAIL'} V({net}) = {got:.4g} V, hand calculation {v:.4g} V")
        for p in sim["parts"]:  # and each resistor's current, from the hand-calculated node voltages
            if p["kind"] == "resistor" and p["id"] in parts and all(n in expected for n in p["nets"]):
                want = (expected[p["nets"][0]] - expected[p["nets"][1]]) / p["params"]["R"]
                got = parts[p["id"]]["i_final"]
                ok = abs(got - want) <= max(1e-6, 0.01 * abs(want))
                lines.append(f"{'PASS' if ok else 'FAIL'} I({p['id']}) = {got:.4g} A, hand calculation {want:.4g} A")
        return lines or ["INFO nothing to compare"]
    switches = [p for p in sim["parts"] if p["kind"] in ("gto", "thyristor")]
    src = next((p for p in sim["parts"] if p["kind"] == "dc_voltage"), None)
    if switches and src:
        mids = {n for p in switches for n in p["nets"][:2]} - {src["nets"][0], src["nets"][1]}
        for p in sim["parts"]:
            if p["kind"] == "resistor" and set(p["nets"]) <= mids and p["id"] in parts:
                # Two devices conduct in series with the load, each dropping its forward voltage (0.8 V default).
                vdc, r = src["params"]["v0"], parts[p["id"]]
                expect = vdc - 2 * 0.8
                ok = all(abs(abs(x) - expect) <= max(0.05 * expect, 0.05) for x in (r["v_max"], r["v_min"]))
                ok = ok and r["v_max"] > 0 > r["v_min"]
                lines.append(f"{'PASS' if ok else 'FAIL'} {p['id']} sees a square wave {r['v_min']:.4g} .. "
                             f"{r['v_max']:.4g} V, hand calculation ±{expect:.4g} V ({vdc:g} V less two 0.8 V drops)")
        return lines or ["INFO bridge load not found; see results.json"]
    lines.append("INFO non-linear circuit (lamp/diode): no hand calculation; simulated values below")
    for name, n in nodes.items():
        lines.append(f"INFO V({name}) = {n['final']:.4g} V")
    for name, p in parts.items():
        lines.append(f"INFO {name}: {p['v_final']:.4g} V, {p['i_final']:.4g} A")
    return lines


def _list(x):
    return x if isinstance(x, list) else ([x] if x else [])


def main():
    ap = argparse.ArgumentParser(description="Build a Simulink/Simscape model from schematic-reader JSON.")
    ap.add_argument("input", help="<name>.json from the schematic reader, or an edited <name>.sim.json")
    ap.add_argument("--run", action="store_true", help="Run MATLAB: build the .slx, simulate and check it")
    ap.add_argument("--thyristor-model", choices=["auto", "thyristor", "gto"], default="auto",
                    help="auto: gate-turn-off model when fed from DC (no commutation circuit drawn)")
    ap.add_argument("--matlab", default=MATLAB, help="Path to matlab.exe")
    args = ap.parse_args()

    src = Path(args.input)
    data = json.loads(src.read_text(encoding="utf-8"))
    if src.name.endswith(".sim.json"):
        sim = data
    else:
        sim = normalize(data, safe(src.stem), args.thyristor_model)
    out = OUT / sim["name"]
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{sim['name']}.sim.json").write_text(json.dumps(sim, indent=2, ensure_ascii=False), encoding="utf-8")
    script = out / f"build_{sim['name']}.m"
    script.write_text(matlab_script(sim), encoding="utf-8")

    print(f"{sim['name']}: {len(sim['parts'])} blocks, ground {sim['ground']}, "
          f"stop {sim['stop_time']:.3g} s -> {out}")
    for a in sim["assumed"]:
        print(f"  assumed: {a}")
    for i in sim["issues"]:
        print(f"  ISSUE: {i}")
    if not args.run:
        print(f"  build it in MATLAB with: run('{script}')")
        return

    proc = subprocess.run([args.matlab, "-batch", f"run('{script.as_posix()}')"], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"  MATLAB failed:\n{proc.stdout[-3000:]}{proc.stderr[-3000:]}")
    res = json.loads((out / f"{model_name(sim)}.results.json").read_text(encoding="utf-8"))
    report = check(sim, res)
    (out / f"{sim['name']}.check.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"  built {model_name(sim)}.slx and simulated:")
    for line in report:
        print(f"  {line}")


if __name__ == "__main__":
    main()
