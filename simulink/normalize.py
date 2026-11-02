"""Stage 2: turn the schematic reader's JSON into a simulation description (<name>.sim.json).

Every part gets a Simscape block, numeric SI parameters and a port -> net map. Anything the drawing does
not give (unreadable values, gate timing, the ground node) is filled with a stated default and listed
under "assumed", so the model can be built but nothing invented is hidden.
"""
import math
import re

# Port order verified in R2025b by simulation (see README): LConn1 is +/anode, RConn1 is -/cathode;
# the piecewise-linear thyristor and GTO have the gate (a physical signal) on LConn1, A on RConn1, K on RConn2.
BLOCKS = {
    "resistor": ("fl_lib/Electrical/Electrical Elements/Resistor", ["LConn1", "RConn1"]),
    "capacitor": ("fl_lib/Electrical/Electrical Elements/Capacitor", ["LConn1", "RConn1"]),
    "inductor": ("fl_lib/Electrical/Electrical Elements/Inductor", ["LConn1", "RConn1"]),
    "dc_voltage": ("fl_lib/Electrical/Electrical Sources/DC Voltage Source", ["LConn1", "RConn1"]),
    "ac_voltage": ("fl_lib/Electrical/Electrical Sources/AC Voltage Source", ["LConn1", "RConn1"]),
    "dc_current": ("fl_lib/Electrical/Electrical Sources/DC Current Source", ["LConn1", "RConn1"]),
    "diode": ("ee_lib/Semiconductors & Converters/Diode", ["LConn1", "RConn1"]),
    "thyristor": ("ee_lib/Semiconductors & Converters/Thyristor (Piecewise Linear)", ["RConn1", "RConn2", "LConn1"]),
    "gto": ("ee_lib/Semiconductors & Converters/GTO", ["RConn1", "RConn2", "LConn1"]),
    "lamp": ("ee_lib/Passive/Incandescent Lamp", ["LConn1", "RConn1"]),
}
PIN_ORDER = {  # reader pin names, in the order of the block ports above
    "diode": ["A", "K"], "thyristor": ["A", "K", "G"], "gto": ["A", "K", "G"],
    "dc_voltage": ["+", "-"], "ac_voltage": ["+", "-"], "dc_current": ["+", "-"],
}
DEFAULTS = {  # used when the drawing gives no readable value
    "resistor": 1e3, "load": 10.0, "capacitor": 1e-6, "inductor": 1e-3,
    "dc_voltage": 10.0, "dc_current": 1e-3, "ac_voltage": 230.0, "frequency": 50.0,
}
UNITS = {"resistor": "Ω", "capacitor": "F", "inductor": "H", "dc_voltage": "V", "ac_voltage": "V", "dc_current": "A"}
PREFIX = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9}
GROUND_NAMES = {"gnd", "0", "0v", "vss", "com", "-v", "v-", "ground"}
SWITCH_FREQ = 50.0


def parse_value(text: str) -> float | None:
    """'5Ω' -> 5, '3μF' -> 3e-6, '4.7k' -> 4700, '2.2 mH' -> 0.0022, '230V' -> 230. None if not a number."""
    t = (text or "").strip().replace(" ", "").replace(",", ".")
    m = re.match(r"^([0-9]*\.?[0-9]+)([pnuµμmkKMG]?)", t)
    if not m:
        return None
    number, prefix = float(m.group(1)), m.group(2)
    rest = t[m.end():]
    # "5m" is milli, but in "5Meg"/"5MΩ" M is mega; a bare "m" before Ω/F/H/V/A is milli.
    if prefix == "m" and rest[:2].lower() == "eg":
        return number * 1e6
    return number * PREFIX.get(prefix, 1)


def _frequency(text: str) -> float | None:
    m = re.search(r"([0-9]*\.?[0-9]+)\s*([kK]?)Hz", text or "")
    return float(m.group(1)) * (1e3 if m.group(2) else 1) if m else None


def _kind(comp: dict) -> str | None:
    cat, role, value = comp["category"], comp.get("role", "").lower(), comp.get("value", "")
    if cat in ("battery", "voltage_source"):
        return "ac_voltage" if ("ac" in role.split() or "~" in value or "hz" in value.lower()) else "dc_voltage"
    if cat == "current_source":
        return "dc_current"
    if cat in ("led",):
        return "diode"
    if cat == "other" and len(comp["pins"]) == 2:
        return "load"
    return cat if cat in ("resistor", "capacitor", "inductor", "diode", "thyristor", "lamp", "ground") else None


def normalize(circuit: dict, name: str, thyristor_model: str = "auto") -> dict:
    parts, issues, assumed = [], [], []
    comps = circuit["components"]

    # Ground: a ground symbol's net, else a conventional ground name, else the source's negative terminal.
    nets = sorted({p["net"] for c in comps for p in c["pins"]} - {"unknown", "NC"})
    ground = next((c["pins"][0]["net"] for c in comps if c["category"] == "ground" and c["pins"]), None)
    ground = ground or next((n for n in nets if n.lower() in GROUND_NAMES), None)
    sources = [c for c in comps if c["category"] in ("battery", "voltage_source", "current_source")]
    if not ground and sources:
        ground = next((p["net"] for p in sources[0]["pins"] if p["pin"] == "-"), None)
    if not ground and nets:
        ground = nets[0]
        assumed.append(f"Ground: no ground symbol or source; {ground} used as the reference.")
    dc_fed = any(_kind(c) == "dc_voltage" for c in sources)
    drawn = circuit.get("layout", {}).get("parts", {})

    for c in comps:
        d = c["designator"]
        kind = _kind(c)
        if kind == "ground":
            continue
        if kind is None:
            issues.append(f"{d} ({c['category']}): no Simscape mapping yet; left out of the model.")
            continue
        pins = {p["pin"]: p["net"] for p in c["pins"]}
        part = {"id": d, "kind": kind, "params": {}, "assumed": [], "value_text": c.get("value", "unknown")}

        if kind == "thyristor":
            use_gto = thyristor_model == "gto" or (thyristor_model == "auto" and dc_fed)
            if use_gto:
                kind = part["kind"] = "gto"
                part["assumed"].append("Modelled as a gate-turn-off thyristor: SCRs fed from DC cannot turn off "
                                       "without a commutation circuit, which the drawing does not show.")
        if kind in ("load",):
            part["kind"], kind = "resistor", "resistor"
            v = parse_value(c.get("value", ""))
            part["params"]["R"] = v if v is not None else DEFAULTS["load"]
            if v is None:
                part["assumed"].append(f"Load value not given; modelled as a {DEFAULTS['load']:g} Ω resistor.")
        elif kind in ("resistor", "capacitor", "inductor", "dc_voltage", "dc_current", "ac_voltage"):
            key = {"resistor": "R", "capacitor": "c", "inductor": "l", "dc_voltage": "v0",
                   "dc_current": "i0", "ac_voltage": "amp"}[kind]
            v = parse_value(c.get("value", ""))
            if v is None:
                v = DEFAULTS[kind]
                part["assumed"].append(f"Value not readable; default {v:g} {UNITS[kind]}.")
            if kind == "ac_voltage":
                f = _frequency(c.get("value", ""))
                part["params"]["frequency"] = f or DEFAULTS["frequency"]
                if f is None:
                    part["assumed"].append(f"Frequency not given; {DEFAULTS['frequency']:g} Hz.")
                part["assumed"].append(f"{v:g} V read as RMS; peak amplitude {v * math.sqrt(2):.4g} V.")
                v *= math.sqrt(2)
            part["params"][key] = v
        elif kind == "lamp":
            part["assumed"].append("Lamp modelled with the Incandescent Lamp block's default ratings (12 V).")

        # Ports: map reader pins onto block ports in the verified order.
        order = PIN_ORDER.get(kind) or list(pins)[:2]
        if kind == "resistor" and len(pins) == 2:
            order = list(pins)
        missing = [p for p in order if p not in pins]
        if missing:
            issues.append(f"{d}: pins {missing} not read; left out of the model.")
            continue
        part["nets"] = [pins[p] for p in order]
        if any(n in ("unknown", "NC") for n in part["nets"][:2]):
            issues.append(f"{d}: a main terminal is not connected ({part['nets']}); left out of the model.")
            continue
        if d in drawn:  # where it is drawn; "sides" follows the port order, like "nets"
            at = drawn[d]
            part["at"] = {"x": at["x"], "y": at["y"], "orientation": at.get("orientation"),
                          "sides": [at.get("pins", {}).get(p) for p in order]}
        parts.append(part)

    _gate_timing(parts, sources, issues, assumed)
    switching = any(p["kind"] in ("thyristor", "gto") for p in parts)
    ac = [p["params"]["frequency"] for p in parts if p["kind"] == "ac_voltage"]
    if switching or ac:
        period = 1 / (ac[0] if ac else SWITCH_FREQ)
        stop, max_step = 5 * period, period / 2000
    else:  # DC: long enough for every RC/RL to settle (crude upper bound on the time constants)
        r_total = sum(p["params"].get("R", 0) for p in parts) or 1.0
        taus = [p["params"]["c"] * r_total for p in parts if "c" in p["params"]]
        taus += [p["params"]["l"] / max(min((p["params"].get("R", 1e9) for p in parts if "R" in p["params"]),
                                            default=1.0), 1e-3) for p in parts if "l" in p["params"]]
        stop = max(1e-3, 10 * max(taus, default=0))
        max_step = stop / 1000
    for p in parts:
        assumed += [f"{p['id']}: {a}" for a in p.pop("assumed")]
    sim = {"name": name, "ground": ground, "parts": parts, "stop_time": stop, "max_step": max_step,
           "assumed": assumed, "issues": issues}
    if any("at" in p for p in parts):  # drawing size and ground symbols, for placing blocks like the drawing
        grounds = [{"x": drawn[c["designator"]]["x"], "y": drawn[c["designator"]]["y"]} for c in comps
                   if c["category"] == "ground" and c["designator"] in drawn and c["pins"]
                   and c["pins"][0]["net"] == ground]
        sim["drawing"] = {"size": circuit["layout"]["size"], "grounds": grounds}
    return sim


def _gate_timing(parts, sources, issues, assumed):
    """Fire bridge legs as a square-wave inverter: upper-left with lower-right, then the other diagonal.
    A device is 'upper' if its anode is on the source + rail, 'lower' if its cathode is on the - rail;
    its other terminal is the leg midpoint. Anything else fires at 0 and is reported."""
    switches = [p for p in parts if p["kind"] in ("thyristor", "gto")]
    if not switches:
        return
    pos = next((n for s in parts if s["kind"] in ("dc_voltage", "ac_voltage") for n in s["nets"][:1]), None)
    neg = next((s["nets"][1] for s in parts if s["kind"] in ("dc_voltage", "ac_voltage")), None)
    mids = sorted({p["nets"][1] if p["nets"][0] == pos else p["nets"][0] for p in switches
                   if p["nets"][0] == pos or p["nets"][1] == neg})
    for p in switches:
        a, k = p["nets"][0], p["nets"][1]
        if a == pos and k in mids:
            phase = 0.0 if mids.index(k) == 0 else 180.0
        elif k == neg and a in mids:
            phase = 180.0 if mids.index(a) == 0 else 0.0
        else:
            phase = 0.0
            issues.append(f"{p['id']}: not recognised as part of a bridge leg; its gate fires at 0°.")
        p["gate"] = {"frequency": SWITCH_FREQ, "phase_deg": phase, "width_pct": 50 if p["kind"] == "gto" else 10}
        p["params"]["gate"] = f"{SWITCH_FREQ:g} Hz, {phase:g}°"
    assumed.append(f"Gate timing is not in the drawing: switches fire as a square-wave bridge at "
                   f"{SWITCH_FREQ:g} Hz (diagonal pairs 180° apart). Edit 'gate' in the .sim.json to change it.")
