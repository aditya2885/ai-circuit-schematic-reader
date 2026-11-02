#!/usr/bin/env python3
"""Add the drawing layout (where each part sits, which way it points) to a result written before
analyze.py saved it, without re-reading the circuit. Only the part boxes are asked of the model again;
the saved components and nets are left exactly as they are.

    python scripts/add_layout.py circuit.png results/circuit.json
    python scripts/add_layout.py handwritten.jpeg results/handwritten.json --overlay results/handwritten.trace.png

The model's boxes are not always as good as on the original run. --overlay reuses the original run's part
boxes (the red rectangles in its .trace.png) for every part it can match, and asks the model only for the rest.
"""
import argparse
import copy
import json
import sys
from pathlib import Path

import ollama
from PIL import Image

import wires
from analyze import prepare_image
from schema import SchematicAnalysis
from wires import trace

RED = (220, 0, 0)  # the colour wires._overlay draws part boxes in


def overlay_boxes(path: Path, size) -> list[tuple[int, int, int, int]]:
    """The part boxes drawn on a .trace.png: outlines in RED (the designator text above each touches it)."""
    img = Image.open(path).convert("RGB")
    if img.size != tuple(size):
        sys.exit(f"{path} is {img.size}, the prepared image is {tuple(size)}: not from the same run settings.")
    mask = Image.new("L", img.size)
    mask.putdata([255 if p == RED else 0 for p in zip(*[iter(img.tobytes())] * 3)])
    labels, n = wires._label(mask)
    W = img.size[0]
    pixels = [[] for _ in range(n + 1)]
    for i, r in enumerate(labels):
        if r:
            pixels[r].append((i % W, i // W))
    boxes = []
    for pts in pixels[1:]:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if w < 20 or h < 20:
            continue  # a text label on its own
        # Edges are the columns/rows that are mostly red; the label only adds a few short rows on top.
        cols = [x for x in range(min(xs), max(xs) + 1) if xs.count(x) >= 0.5 * h]
        rows = [y for y in range(min(ys), max(ys) + 1) if ys.count(y) >= 0.5 * w]
        if cols and rows:
            boxes.append((min(cols), min(rows), max(cols), max(rows)))
    return boxes


def main() -> None:
    ap = argparse.ArgumentParser(description="Add a 'layout' entry to an existing schematic-reader JSON.")
    ap.add_argument("image", help="The image the JSON was made from")
    ap.add_argument("json", help="The result JSON to extend")
    ap.add_argument("--model", default="qwen3-vl:8b-instruct")
    ap.add_argument("--max-side", type=int, default=1600, help="Must match the original run (default 1600)")
    ap.add_argument("--ctx", type=int, default=12288)
    ap.add_argument("--raw", action="store_true", help="The original run used --raw")
    ap.add_argument("--overlay", help="The original run's .trace.png, to reuse its part boxes")
    args = ap.parse_args()

    path = Path(args.json)
    report = json.loads(path.read_text(encoding="utf-8"))
    saved = SchematicAnalysis.model_validate(report).components
    image_bytes, size = prepare_image(Path(args.image), args.max_side, not args.raw)
    if args.overlay:
        old = overlay_boxes(Path(args.overlay), size)
        locate = wires.locate

        def reuse(*a, **k):  # a newly located box whose centre lies in an old box is replaced by the old box
            found = locate(*a, **k)
            for d, (x1, y1, x2, y2) in found.items():
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                hit = [b for b in old if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]]
                if hit:
                    found[d] = min(hit, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
                    print(f"  {d}: box from the original run {found[d]}")
            return found
        wires.locate = reuse
    layout = {}
    components = copy.deepcopy(saved)  # traced on a copy: the saved reading is not changed
    for note in trace(ollama.Client(), args.model, image_bytes, components, args.ctx, layout=layout):
        print(f"  {note}")
    if not layout.get("parts"):
        sys.exit("No parts could be located; nothing added.")

    # Pin sides belong to the traced pins. Keep them only where the re-trace joined the same nets as the
    # saved reading (or the same nets the other way round, which only swaps the sides).
    before = {c.designator: [p.net for p in c.pins] for c in saved}
    for c in components:
        entry = layout["parts"].get(c.designator)
        if not entry or "pins" not in entry:
            continue
        now, names = [p.net for p in c.pins], [p.pin for p in c.pins]
        if now == before.get(c.designator):
            continue
        if len(now) >= 2 and [now[1], now[0]] + now[2:] == before.get(c.designator):
            s = entry["pins"]
            s[names[0]], s[names[1]] = s.get(names[1]), s.get(names[0])
            entry["pins"] = {k: v for k, v in s.items() if v}
        else:
            del entry["pins"], entry["orientation"]
            print(f"  {c.designator}: re-trace disagrees with the saved nets; position kept, orientation dropped")
    report["layout"] = layout
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"{path}: layout for {len(layout['parts'])} parts at {size[0]}x{size[1]} px")
    for d, e in layout["parts"].items():
        print(f"  {d}: ({e['x']}, {e['y']}) {e.get('orientation', '?')} {e.get('pins', {})}")


if __name__ == "__main__":
    main()
