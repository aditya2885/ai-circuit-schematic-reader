"""Netlist reconstruction: build nets from pin connections, sanity-check them,
merge several cropped images of one schematic, and write a readable netlist."""
import re
from collections import defaultdict

from schema import Component, PinConnection

SPECIAL_NETS = {"unknown", "NC"}
TWO_PIN_PARTS = {"resistor", "capacitor", "inductor", "diode", "led", "fuse",
                 "battery", "lamp", "voltage_source", "current_source"}
AUTO_NET = re.compile(r"^(?:[\w-]+:)?N\d+$")  # N1, N2 ... (optionally prefixed by a crop tag)


def build_nets(components: list[Component]) -> dict[str, list[str]]:
    """Map each net name to the list of 'DESIGNATOR.PIN' endpoints on it."""
    nets = defaultdict(list)
    for comp in components:
        for p in comp.pins:
            nets[p.net.strip()].append(f"{comp.designator}.{p.pin}")
    return dict(sorted(nets.items(), key=lambda kv: (AUTO_NET.match(kv[0]) is not None, kv[0])))


def check_connectivity(components: list[Component]) -> list[str]:
    """Flag the typical mistakes a vision model makes when tracing wires."""
    warnings = []
    seen = set()
    for comp in components:
        d = comp.designator
        if d != "unknown" and d in seen:
            warnings.append(f"Duplicate designator {d}: two parts read with the same reference.")
        seen.add(d)

        if not comp.pins:
            warnings.append(f"{d}: no pin connections were read.")
            continue
        unknown = sum(p.net in SPECIAL_NETS - {"NC"} for p in comp.pins)
        if unknown:
            warnings.append(f"{d}: {unknown} pin(s) could not be traced.")
        if comp.category in TWO_PIN_PARTS:
            if len(comp.pins) != 2:
                warnings.append(f"{d} ({comp.category}) has {len(comp.pins)} pins listed, expected 2.")
            elif comp.pins[0].net == comp.pins[1].net and comp.pins[0].net not in SPECIAL_NETS:
                warnings.append(f"{d}: both pins on net {comp.pins[0].net} (shorted part or misread wire).")

    if components and not any(c.category in ("battery", "voltage_source", "current_source") for c in components):
        warnings.append("No power source (battery or voltage/current source) was read; check whether the "
                        "drawing has one the model missed.")
    for net, members in build_nets(components).items():
        if net in SPECIAL_NETS:
            continue
        if len(members) == 1:
            warnings.append(f"Net {net} has only one connection ({members[0]}): missed wire, "
                            f"or it continues on another sheet/crop.")
    return warnings


def format_netlist(components: list[Component], source: str) -> str:
    nets = build_nets(components)
    lines = [
        f"# Netlist reconstructed by schematic-reader from: {source}",
        "# UNVERIFIED: machine-read from an image. Check against the schematic before using it.",
        "",
        "## Components",
    ]
    for c in components:
        pins = "  ".join(f"{p.pin}={p.net}" for p in c.pins) or "(no pins read)"
        lines.append(f"{c.designator:<8} {c.category:<10} {c.value:<10} {c.part_number:<16} {pins}")
    lines += ["", "## Nets"]
    for net, members in nets.items():
        lines.append(f"{net} ({len(members)}): {', '.join(members)}")
    return "\n".join(lines) + "\n"


class _NetUnion:
    """Union-find over net names. Prefers real labels (GND, +5V) over auto names (N3)."""

    def __init__(self):
        self.parent = {}

    def find(self, n):
        self.parent.setdefault(n, n)
        while self.parent[n] != n:
            self.parent[n] = self.parent[self.parent[n]]
            n = self.parent[n]
        return n

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if AUTO_NET.match(ra) and not AUTO_NET.match(rb):
            ra, rb = rb, ra
        self.parent[rb] = ra


def merge_results(results: list[tuple[str, list[Component]]]) -> tuple[list[Component], list[str]]:
    """Merge components from several crops of the same schematic.

    Parts are matched by designator. Auto-named nets (N1...) are made unique per crop,
    then joined wherever the same pin of the same part was seen in two crops - so
    overlapping crops stitch unlabelled wires back together.
    """
    uf = _NetUnion()
    warnings = []
    merged: dict[str, dict] = {}
    unnamed = 0

    for tag, components in results:
        for comp in components:
            key = comp.designator
            if key == "unknown":
                unnamed += 1
                key = f"unknown_{unnamed}"
            entry = merged.setdefault(key, {"comp": comp.model_copy(deep=True), "pins": {}})
            base = entry["comp"]
            for field in ("value", "part_number", "role"):
                if getattr(base, field) == "unknown" and getattr(comp, field) != "unknown":
                    setattr(base, field, getattr(comp, field))

            for p in comp.pins:
                net = f"{tag}:{p.net}" if AUTO_NET.match(p.net) else p.net
                uf.find(net)
                prev = entry["pins"].get(p.pin)
                if prev is None or prev in SPECIAL_NETS:
                    entry["pins"][p.pin] = net
                elif net not in SPECIAL_NETS and prev != net:
                    if AUTO_NET.match(prev) or AUTO_NET.match(net):
                        uf.union(prev, net)
                    else:
                        warnings.append(f"{key}.{p.pin}: read as {prev} in one crop and {net} in another.")

    # Renumber auto nets from all crops into one clean sequence: N1, N2, ...
    renamed: dict[str, str] = {}

    def final_name(n: str) -> str:
        if n in SPECIAL_NETS:
            return n
        root = uf.find(n)
        if AUTO_NET.match(root):
            renamed.setdefault(root, f"N{len(renamed) + 1}")
            return renamed[root]
        return root

    out = []
    for key, entry in merged.items():
        comp = entry["comp"]
        comp.designator = key
        comp.pins = [PinConnection(pin=pin, net=final_name(n)) for pin, n in entry["pins"].items()]
        out.append(comp)
    return out, warnings
