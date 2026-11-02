"""Follow-up conversation about an analysed circuit.

Two kinds of request are carried out directly, never by the language model, so the app only says a change
was made when it was: editing a part ("change R1 to 10 ohms", "set C1 value to 4.7uF") and building the
Simulink model ("generate the MATLAB model"). Everything else is answered by the vision model, given the
analysis data and the schematic image, and streamed back token by token.

Events (server-sent, one JSON object per 'data:' line):
    {"type": "action", "action": "edit" | "simulink", ...}   a change the server made
    {"type": "token", "text": "..."}                       part of the answer
    {"type": "error", "message": "..."}                    the request failed
    {"type": "done"}
"""
import io
import json
import re

import ollama
from PIL import Image

import circuit
import pipeline

SYSTEM = """You are the engineering assistant inside AI Circuit Schematic Reader, a tool that reads circuit
schematics from images. Answer the user's questions about the circuit precisely and concisely, as an
experienced electronics engineer would, using Markdown (short paragraphs, lists, `code` for designators
and values, LaTeX-free formulas such as I = V / R).
{context}"""

CONTEXT = """
The circuit below was machine-read from the attached image and may contain mistakes. Base your answer on
this data and the image. When the answer depends on a part flagged as uncertain, say so. Never claim you
changed the circuit: edits and model builds are done by the app, not by you.

Analysis data (JSON):
{data}"""

NO_CONTEXT = """
No schematic has been analysed in this conversation yet. If the user wants an analysis, ask them to attach a
schematic image (JPG, PNG or PDF) with the paperclip or by dropping it on the page."""

EDIT = re.compile(r"\b(?:change|set|make|update|replace|correct|fix)\b(?P<rest>.*?)\b(?:to|=|as|into)\s+(?P<value>[^,;\n]+?)\s*[.!]?\s*$",
                  re.I)
OPEN = re.compile(r"\b(?:open|show|launch|view)\b.*\b(?:matlab|simulink|model)\b", re.I)
BUILD = re.compile(r"\b(?:generate|build|create|make|run|rebuild|regenerate|simulate)\b.*\b(?:matlab|simulink|simscape|model|simulation)\b"
                   r"|\bsimulate\b", re.I)
CATEGORIES = {"resistor", "capacitor", "inductor", "diode", "led", "transistor", "mosfet", "thyristor", "ic",
              "connector", "crystal", "fuse", "switch", "battery", "voltage_source", "current_source", "lamp",
              "meter", "ground", "other"}


def _event(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _find_part(rest: str, comps: list[dict]) -> dict | None:
    """The one part named in the request (designators are matched as whole words, case-insensitively)."""
    hits = [c for c in comps if c["designator"] != "unknown"
            and re.search(rf"(?<![\w]){re.escape(c['designator'])}(?![\w])", rest, re.I)]
    return hits[0] if len(hits) == 1 else None


def try_edit(job_id: str, message: str) -> list[str] | None:
    m = EDIT.search(message)
    if not m:
        return None
    report = circuit.load(pipeline.folder(job_id))
    if report is None:
        return None
    part = _find_part(m["rest"], report["components"])
    if part is None:
        return None
    new = m["value"].strip().strip("'\"")
    cat = new.lower().removeprefix("a ").removeprefix("an ").strip().replace(" ", "_")
    field, old = ("category", part["category"]) if cat in CATEGORIES else ("value", part["value"])
    new = cat if field == "category" else circuit.tidy_value(new)
    comps = [dict(c) for c in report["components"]]
    for c in comps:
        if c["designator"] == part["designator"]:
            c[field] = new
    job = pipeline.get(job_id)
    circuit.save_components(pipeline.folder(job_id), comps, job["file"]["name"])
    pipeline.mark_stale(job_id)
    sim = job["simulink"]["status"] in ("done", "error")
    return [
        _event({"type": "action", "action": "edit", "designator": part["designator"], "field": field,
                "old": old, "new": new}),
        _event({"type": "token", "text": f"Updated **{part['designator']}** {field} from `{old}` to `{new}`. "
                                         "The netlist, connections and bill of materials were regenerated."
                + (" The Simulink model is now out of date: ask me to generate it again, or use "
                   "**Rebuild model** in the MATLAB/Simulink tab." if sim else "")}),
    ]


def try_build(job_id: str, message: str) -> list[str] | None:
    if not BUILD.search(message) or re.search(r"\b(how|what|why|explain|describe)\b", message, re.I):
        return None
    try:
        pipeline.start_simulink(job_id)
    except (RuntimeError, FileNotFoundError) as err:
        return [_event({"type": "error", "message": str(err)})]
    return [_event({"type": "action", "action": "simulink", "status": "started"}),
            _event({"type": "token", "text": "Started building the Simulink/Simscape model. Progress, the "
                                             "simulation check and the downloads appear in the "
                                             "**MATLAB/Simulink** tab."})]


def try_open(job_id: str, message: str) -> list[str] | None:
    if not OPEN.search(message) or re.search(r"\b(how|what|why|explain|describe)\b", message, re.I):
        return None
    try:
        model = pipeline.open_in_matlab(job_id)
    except (RuntimeError, FileNotFoundError) as err:
        return [_event({"type": "error", "message": str(err)})]
    return [_event({"type": "action", "action": "simulink", "status": "opened"}),
            _event({"type": "token", "text": f"Opening **{model}** in MATLAB on the server's PC. It appears in about "
                                             "30 seconds and starts simulating; the **Node voltages** scope shows the result."})]


def _context(job_id: str) -> tuple[str, bytes | None]:
    f = pipeline.folder(job_id)
    view = circuit.view(f)
    if view is None:
        return NO_CONTEXT, None
    data = {k: view[k] for k in ("circuit_type", "summary", "topology", "design_notes", "warnings", "unreadable")}
    data["components"] = [{k: c[k] for k in ("designator", "category", "value", "role", "pins")}
                          | {"evidence": c["evidence"]["level"] if c.get("evidence") else None}
                          for c in view["components"]]
    data["nets"] = {r["net"]: [f"{m['designator']}.{m['pin']}" for m in r["members"]] for r in view["connections"]}
    sim = pipeline.get(job_id)["simulink"]
    if sim["check"]:
        data["simulink_check"] = sim["check"]
    image = next((p for p in f.iterdir() if p.stem == circuit.STEM and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp")), None)
    img_bytes = None
    if image is not None:
        im = Image.open(image).convert("RGB")
        im.thumbnail((1000, 1000))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        img_bytes = buf.getvalue()
    return CONTEXT.format(data=json.dumps(data, ensure_ascii=False, indent=1)), img_bytes


def stream(job_id: str | None, message: str, history: list[dict], model: str, ctx: int = 12288):
    """Generator of server-sent events answering one user message."""
    try:
        if job_id and pipeline.get(job_id) and pipeline.get(job_id)["status"] == "done":
            for handler in (try_edit, try_open, try_build):
                events = handler(job_id, message)
                if events:
                    yield from events
                    yield _event({"type": "done"})
                    return
            context, image = _context(job_id)
        else:
            context, image = NO_CONTEXT, None
        msgs = [{"role": "system", "content": SYSTEM.format(context=context)}]
        msgs += [{"role": h["role"], "content": h["content"]} for h in history[-12:]
                 if h.get("role") in ("user", "assistant") and h.get("content")]
        msgs.append({"role": "user", "content": message} | ({"images": [image]} if image else {}))
        # Same num_ctx as the reader: Ollama reloads the model whenever it changes.
        for part in ollama.Client().chat(model=model, messages=msgs, stream=True,
                                         options={"num_ctx": ctx, "temperature": 0.3}):
            text = part["message"]["content"]
            if text:
                yield _event({"type": "token", "text": text})
        yield _event({"type": "done"})
    except ollama.ResponseError as err:
        yield _event({"type": "error", "message": f"Ollama: {err.error}"})
    except ConnectionError:
        yield _event({"type": "error", "message": "Ollama is not running. Start the Ollama app and try again."})
    except Exception as err:
        yield _event({"type": "error", "message": f"{type(err).__name__}: {err}"})
