"""Views of one reader result (<analysis>/schematic.json) for the web app, and edits to it.

Nothing here invents data: per-part evidence comes from the reader's own warnings and the wire tracer's
layout, the BOM and connections are regroupings of the components, and the netlist is the reader's
own format_netlist().
"""
import json
import re
from collections import OrderedDict
from pathlib import Path

from paths import READER_SCRIPTS  # noqa: F401  (puts the reader on sys.path)
from analyze import to_markdown, write_bom_csv
from netlist import SPECIAL_NETS, build_nets, check_connectivity, format_netlist
from schema import Component, SchematicAnalysis

STEM = "schematic"  # every analysis folder holds schematic.<ext> and the reader's schematic.* outputs

# Notes from the reader that mean a part's reading is doubtful, with a short reason for the UI.
DOUBT = [
    ("symbol not found", "symbol not found in the drawing"),
    ("could not trace its wires", "wires could not be traced"),
    ("probably misplaced", "box overlaps another part"),
    ("pin(s) could not be traced", "some pins not traced"),
    ("added by a targeted second look", "added by a second look"),
    ("both pins on net", "both pins on one net"),
    ("pins listed, expected", "wrong pin count"),
    ("no pin connections", "no pins read"),
    ("direction could not be measured", "direction not measured"),
]


def paths(folder: Path) -> dict[str, Path]:
    return {k: folder / f"{STEM}{s}" for k, s in
            [("json", ".json"), ("orig", ".orig.json"), ("net", ".net.txt"), ("bom", ".bom.csv"),
             ("md", ".md"), ("trace", ".trace.png")]}


def load(folder: Path) -> dict | None:
    p = paths(folder)["json"]
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _tracing_used(warnings: list[str]) -> bool:
    """True when the wire tracer's result was applied (not the 'using the model's wire reading' fallback)."""
    summary = [w for w in warnings if w.startswith("Wire tracing")]
    return bool(summary) and not any("using the model's wire reading" in w for w in summary)


def evidence(report: dict) -> dict[str, dict]:
    """Per designator: level ('traced' | 'model' | 'check') and the reasons, from the reader's warnings."""
    warnings = report.get("connectivity_warnings", [])
    located = set(report.get("layout", {}).get("parts", {}))
    traced = _tracing_used(warnings)
    out = {}
    for c in report.get("components", []):
        d = c["designator"]
        mine = [w for w in warnings if w.startswith(f"{d}:") or w.startswith(f"{d} (") or f" {d}:" in w
                or w.startswith(f"Duplicate designator {d}:")]
        reasons = [label for w in mine for key, label in DOUBT if key in w]
        if c.get("value", "unknown") == "unknown" and c["category"] != "ground":
            reasons.append("value not readable")
        if any(p["net"] == "unknown" for p in c.get("pins", [])) and "some pins not traced" not in reasons:
            reasons.append("some pins not traced")
        if d in report.get("edited_parts", []):
            reasons.insert(0, "edited by you")
        if reasons:
            level = "check"
        elif traced and d in located:
            level = "traced"
            reasons = ["connections confirmed by wire tracing"]
        else:
            level = "model"
            reasons = ["model reading; not confirmed by wire tracing"]
        retraced = [w.split(": ", 1)[1] for w in mine if "pins re-traced from the wires" in w]
        out[d] = {"level": level, "reasons": list(OrderedDict.fromkeys(reasons)), "corrections": retraced}
    return out


def connections(report: dict) -> list[dict]:
    nets = build_nets([Component.model_validate(c) for c in report.get("components", [])])
    rows = []
    for net, members in nets.items():
        flags = []
        if net in SPECIAL_NETS:
            flags.append("untraced" if net == "unknown" else "no-connect")
        elif len(members) == 1:
            flags.append("single connection")
        rows.append({"net": net, "members": [{"designator": m.rsplit(".", 1)[0], "pin": m.rsplit(".", 1)[1]}
                                              for m in members], "flags": flags})
    return rows


def bom(report: dict) -> list[dict]:
    groups: dict[tuple, list[str]] = OrderedDict()
    for c in report.get("components", []):
        if c["category"] == "ground":
            continue
        groups.setdefault((c["category"], c["value"], c["part_number"]), []).append(c["designator"])
    return [{"category": k[0], "value": k[1], "part_number": k[2], "quantity": len(v), "designators": v}
            for k, v in groups.items()]


def view(folder: Path) -> dict | None:
    """Everything the results dashboard shows, or None before the reader has written its JSON."""
    report = load(folder)
    if report is None:
        return None
    p = paths(folder)
    ev = evidence(report)
    return {
        "circuit_type": report.get("circuit_type", ""),
        "summary": report.get("summary", ""),
        "drawing_style": report.get("drawing_style", ""),
        "confidence": report.get("confidence", ""),
        "topology": report.get("topology", ""),
        "design_notes": report.get("design_notes", []),
        "unreadable": report.get("unreadable_or_uncertain", []),
        "components": [c | {"evidence": ev.get(c["designator"])} for c in report.get("components", [])],
        "connections": connections(report),
        "warnings": report.get("connectivity_warnings", []),
        "netlist": p["net"].read_text(encoding="utf-8") if p["net"].exists() else "",
        "bom": bom(report),
        "layout": report.get("layout"),
        "edited": p["orig"].exists(),
        "tracing_used": _tracing_used(report.get("connectivity_warnings", [])),
    }


def save_components(folder: Path, components: list[dict], source_name: str) -> dict:
    """Replace the components (user edits), then rebuild nets, connectivity warnings, netlist, BOM and report.
    The reader's tracing notes are kept; only the connectivity checks are recomputed. The first edit keeps
    the reader's original answer as schematic.orig.json."""
    p = paths(folder)
    report = load(folder)
    parsed = [Component.model_validate(c) for c in components]   # raises ValidationError on bad input
    old = [Component.model_validate(c) for c in report["components"]]
    if not p["orig"].exists():
        p["orig"].write_text(json.dumps(report, indent=2), encoding="utf-8")
    stale = set(check_connectivity(old))
    notes = [w for w in report.get("connectivity_warnings", []) if w not in stale]
    before = {c.designator: c.model_dump() for c in old}
    report["edited_parts"] = sorted(set(report.get("edited_parts", [])) |
                                    {c.designator for c in parsed if before.get(c.designator) != c.model_dump()})
    report["components"] = [c.model_dump() for c in parsed]
    report["nets"] = build_nets(parsed)
    report["connectivity_warnings"] = notes + check_connectivity(parsed)
    p["json"].write_text(json.dumps(report, indent=2), encoding="utf-8")
    p["net"].write_text(format_netlist(parsed, source_name), encoding="utf-8")
    write_bom_csv(parsed, p["bom"])
    analysis = SchematicAnalysis.model_validate({k: v for k, v in report.items() if k in SchematicAnalysis.model_fields})
    p["md"].write_text(to_markdown(analysis, source_name, report["connectivity_warnings"]), encoding="utf-8")
    return report


UNIT_WORDS = [(r"\s*(?:k\s*ohms?|kilo\s*ohms?)\b", "kΩ"), (r"\s*(?:m\s*ohms?|mega\s*ohms?)\b", "MΩ"),
              (r"\s*ohms?\b", "Ω"), (r"\s*micro\s*farads?\b", "µF"), (r"\s*farads?\b", "F"),
              (r"\s*henr(?:y|ies)\b", "H"), (r"\s*volts?\b", "V"), (r"\s*amps?\b", "A")]


def tidy_value(text: str) -> str:
    """'10 ohms' -> '10Ω', '4.7 k ohm' -> '4.7kΩ', '2 uF' -> '2uF' (the Simulink parser reads all of these)."""
    v = text.strip().rstrip(".!")
    for pat, rep in UNIT_WORDS:
        v = re.sub(pat, rep, v, flags=re.I)
    return re.sub(r"(?<=\d)\s+(?=[a-zA-ZµΩ])", "", v)
