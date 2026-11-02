"""Stage 3: write a MATLAB script that builds the Simulink/Simscape model from a .sim.json, simulates it,
and saves <name>.slx plus <name>.results.json (node voltages and each part's voltage/current).

When the .sim.json says where each part is drawn ("at", "drawing"), blocks are placed and turned like the
drawing, wired net by net along the shortest links, and the measuring blocks sit to the right and the gate
drivers to the left. Without it, blocks go on a grid and Simulink's arrangeSystem tidies them."""
import re
from itertools import combinations

from normalize import BLOCKS

UNIT = {"R": "Ohm", "c": "F", "l": "H", "v0": "V", "i0": "A", "amp": "V", "frequency": "Hz"}
GATE = {"gto": (15.0, -5.0), "thyristor": (10.0, 0.0)}  # pulse amplitude and bias: on > Vgt (6 V), GTO off < -1 V

# Port positions relative to the block centre at Orientation 'right' (measured in R2025b), and where each
# orientation moves a point: 'down' and 'up' turn the block a quarter, 'left' mirrors it.
TWO_PORT = {"LConn1": (-29, 0), "RConn1": (29, 0)}
PORTS = {"thyristor": {"LConn1": (-29, 0), "RConn1": (29, -10), "RConn2": (29, 10)},
         "gto": {"LConn1": (-29, 0), "RConn1": (29, -10), "RConn2": (29, 10)},
         "ground": {"LConn1": (-24, 0)}, "solver": {"RConn1": (29, 0)}, "label": {"LConn1": (-14, 0)}}
TURN = {"right": lambda x, y: (x, y), "down": lambda x, y: (y, x),
        "left": lambda x, y: (-x, y), "up": lambda x, y: (y, -x)}
SIDE = {"top": (0, -1), "bottom": (0, 1), "left": (-1, 0), "right": (1, 0)}
FACE = {(1, 0): "right", (0, 1): "down", (-1, 0): "left", (0, -1): "up"}  # orientation whose right side faces d
SPAN = 1000      # the drawing's long side, in model units
MIN_GAP = 130    # closest two part centres may come, in model units
ALIGN = 30       # centres this close in x (or y) are lined up, as the drawing's rows and columns were meant to be

LIB = {"ground": "fl_lib/Electrical/Electrical Elements/Electrical Reference",
       "solver": "nesl_utility/Solver Configuration", "label": "nesl_utility/Connection Label",
       "sensor": "fl_lib/Electrical/Electrical Sensors/Voltage Sensor",
       "to_sl": "nesl_utility/PS-Simulink Converter", "to_ps": "nesl_utility/Simulink-PS Converter"}


def _num(x: float) -> str:
    return f"{x:.10g}"


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def safe(name: str) -> str:
    """A MATLAB-friendly identifier for a net or part name ('+V' -> 'pV', 'B1-' -> 'B1m')."""
    s = name.replace("+", "p").replace("-", "m")
    s = re.sub(r"\W", "_", s)
    return s if re.match(r"^[A-Za-z]", s) else "n" + s


def model_name(sim: dict) -> str:
    """Suffixed so a model never shadows a MATLAB function (e.g. 'circuit' is one)."""
    return safe(sim["name"]) + "_sim"


def _put(src, name, x, y, orient="right", w=50, h=40, show_name=True) -> str:
    return (f"put(model, {_q(src)}, {_q(name)}, {round(x)}, {round(y)}, {_q(orient)}, {w}, {h}"
            + ("" if show_name else ", 'off'") + ");")


def _port_at(kind, port, x, y, orient):
    dx, dy = TURN[orient](*PORTS.get(kind, TWO_PORT)[port])
    return x + dx, y + dy


def _orient(part) -> str:
    """The orientation that puts each port on the side of the symbol its wire leaves from in the drawing."""
    at = part.get("at") or {}
    offsets, ports = PORTS.get(part["kind"], TWO_PORT), BLOCKS[part["kind"]][1]
    hint = "down" if at.get("orientation") == "vertical" else "right"

    def score(o):
        s = 0
        for port, side in zip(ports, at.get("sides") or []):
            if side in SIDE:
                px, py = TURN[o](*offsets[port])
                s += px * SIDE[side][0] + py * SIDE[side][1]
        return s, o == hint
    return max(TURN, key=score)


def _align(values: list[float]) -> list[float]:
    """Line up coordinates that are nearly equal (a hand-drawn row is never quite straight)."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out, group = list(values), []
    for i in order + [None]:
        if group and (i is None or values[i] - values[group[-1]] > ALIGN):
            mean = round(sum(values[j] for j in group) / len(group) / 10) * 10
            for j in group:
                out[j] = mean
            group = []
        if i is not None:
            group.append(i)
    return out


def _tree(ends):
    """Shortest links joining a net's ports (Prim's algorithm on the Manhattan distance)."""
    dist = lambda a, b: abs(a[2][0] - b[2][0]) + abs(a[2][1] - b[2][1])
    done, links = [0], []
    while len(done) < len(ends):
        i, j = min(((i, j) for i in done for j in range(len(ends)) if j not in done),
                   key=lambda t: dist(ends[t[0]], ends[t[1]]))
        links.append((ends[j], ends[i]))
        done.append(j)
    return links


def _layout(sim: dict):
    """Block centre (x, y) and orientation for every part, scaled from where it is drawn.
    Returns (placements, scale, x offset) so other drawn things (ground symbols) can be mapped the same way."""
    W, H = sim["drawing"]["size"]
    drawn = [p for p in sim["parts"] if "at" in p]
    pts = [(p["at"]["x"], p["at"]["y"]) for p in drawn]
    sep = min((max(abs(a[0] - b[0]), abs(a[1] - b[1])) for a, b in combinations(pts, 2)), default=max(W, H))
    s = min(max(SPAN / max(W, H), MIN_GAP / max(sep, 1)), 3 * SPAN / max(W, H))
    x0 = 500 if any(p["kind"] in GATE for p in sim["parts"]) else 250  # room for the gate drivers
    xs = _align([x0 + x * s for x, _ in pts])
    ys = _align([100 + y * s for _, y in pts])
    place = {p["id"]: (x, y, _orient(p)) for p, x, y in zip(drawn, xs, ys)}
    for i, p in enumerate(q for q in sim["parts"] if "at" not in q):  # not located: a row under the drawing
        place[p["id"]] = (x0 + 120 * i, 100 + H * s + 150, "right")
    return place, s, x0


def _label_spot(port, taken, step=45):
    """Where to put a net label next to a port: the free spot furthest from every other block."""
    best = None
    for d in SIDE.values():
        spot = (port[0] + d[0] * step, port[1] + d[1] * step)
        room = min((abs(spot[0] - t[0]) + abs(spot[1] - t[1]) for t in taken), default=1e9)
        if best is None or room > best[0]:
            best = (room, spot, d)
    return best[1], best[2]


def matlab_script(sim: dict) -> str:
    model = model_name(sim)
    ground = sim["ground"]
    drawn = "drawing" in sim and any("at" in p for p in sim["parts"])
    L = [f"% Generated by simulink/build_simulink.py from {sim['name']}.sim.json.",
         "% Edit the .sim.json (values, gate timing) and rebuild rather than editing this file.",
         f"model = {_q(model)};",
         "here = fileparts(mfilename('fullpath'));",
         "if bdIsLoaded(model), close_system(model, 0); end",
         "new_system(model); load_system('fl_lib'); load_system('ee_lib'); load_system('nesl_utility');",
         f"set_param(model, 'Solver', 'ode23t', 'StopTime', {_q(_num(sim['stop_time']))}, "
         f"'MaxStep', {_q(_num(sim['max_step']))}, 'ReturnWorkspaceOutputs', 'on');",
         ""]
    # endpoints[net] = [(block, port, (x, y) of the port)]
    endpoints: dict[str, list[tuple[str, str, tuple[float, float]]]] = {ground: []}
    centres = []  # every block placed in the circuit area, to keep net labels clear of them

    if drawn:
        place, scale, x0 = _layout(sim)
    else:  # a grid; arrangeSystem tidies it afterwards
        place = {p["id"]: (175 + 120 * (i % 6), 60 + 120 * (i // 6), "right") for i, p in enumerate(sim["parts"])}
    for gi, p in enumerate(sim["parts"]):
        lib, ports = BLOCKS[p["kind"]]
        x, y, o = place[p["id"]]
        centres.append((x, y))
        L.append(_put(lib, p["id"], x, y, o))
        values = [f"{_q(k)}, {_q(_num(v))}, {_q(k + '_unit')}, {_q(UNIT[k])}"
                  for k, v in p["params"].items() if k in UNIT]
        if values:
            L.append(f"set_param([model '/' {_q(p['id'])}], {', '.join(values)});")
        for port, net in zip(ports, p["nets"]):
            if port == "LConn1" and p["kind"] in GATE:
                continue  # the gate is a physical signal, driven below
            endpoints.setdefault(net, []).append((p["id"], port, _port_at(p["kind"], port, x, y, o)))
        if p["kind"] in GATE:
            L += _gate(p, x, y, o, gi, drawn, centres)

    # Reference and solver: at the drawn ground symbols, else under the lowest port on the ground net.
    if drawn:
        spots = [(x0 + g["x"] * scale, 100 + g["y"] * scale + 30) for g in sim["drawing"].get("grounds") or []]
        if not spots:
            low = max(endpoints[ground], key=lambda e: e[2][1], default=("", "", (x0, 100)))
            spots = [(low[2][0], low[2][1] + 60)]
        for k, (gx, gy) in enumerate(spots):
            name = "Ground" if k == 0 else f"Ground{k + 1}"
            L.append(_put(LIB["ground"], name, gx, gy, "down", 40, 40))
            endpoints[ground].append((name, "LConn1", _port_at("ground", "LConn1", gx, gy, "down")))
            centres.append((gx, gy))
        gx, gy = spots[0]
        L.append(_put(LIB["solver"], "Solver", gx - 90, gy - 10, "right"))
        endpoints[ground].append(("Solver", "RConn1", _port_at("solver", "RConn1", gx - 90, gy - 10, "right")))
        centres.append((gx - 90, gy - 10))
    else:
        L += [_put(LIB["solver"], "Solver", 45, 40), _put(LIB["ground"], "Ground", 45, 120)]
        endpoints[ground] = [("Solver", "RConn1", (0, 0)), ("Ground", "LConn1", (0, 0))] + endpoints[ground]

    # A voltage sensor on every node (relative to ground), logged and shown on one scope.
    measured = [n for n in endpoints if n != ground and len(endpoints[n]) > 1]
    L.append("")
    right = max((c[0] for c in centres), default=0) + 250 if drawn else 1000
    top = min((c[1] for c in centres), default=100) if drawn else 40
    for j, net in enumerate(measured):
        s = safe(net)
        y = top + 100 * j
        L += [_put(LIB["sensor"], f"V_{s}", right + 70, y),
              _put(LIB["to_sl"], f"PS_{s}", right + 170, y - 12),
              f"add_block('simulink/Sinks/To Workspace', [model '/log_{s}'], 'Position', "
              f"[{right + 230} {y - 47} {right + 310} {y - 27}]);",
              f"set_param([model '/log_{s}'], 'VariableName', 'v_{s}', 'SaveFormat', 'Array');",
              f"wire(model, 'V_{s}', 'RConn1', 'PS_{s}', 'LConn1');",
              f"wire(model, 'PS_{s}', 'Outport1', 'log_{s}', 'Inport1');"]
        if drawn:  # joined to the circuit by a net label, with its own reference, so no wire crosses the drawing
            L += [_put(LIB["label"], f"Lm_{s}", right, y + 2, "left", 30, 16, False),
                  f"set_param([model '/Lm_{s}'], 'Label', {_q(s)});",
                  f"wire(model, 'Lm_{s}', 'LConn1', 'V_{s}', 'LConn1');",
                  _put(LIB["ground"], f"Gnd_{s}", right + 115, y + 45, "down", 30, 30, False),
                  f"wire(model, 'V_{s}', 'RConn2', 'Gnd_{s}', 'LConn1');"]
            # The circuit-side label goes beside whichever of the net's ports has the most room around it.
            spot, d = max((_label_spot(e[2], centres) for e in endpoints[net]),
                          key=lambda t: min(abs(t[0][0] - c[0]) + abs(t[0][1] - c[1]) for c in centres))
            centres.append(spot)
            L += [_put(LIB["label"], f"L_{s}", spot[0], spot[1], FACE[d], 30, 16, False),
                  f"set_param([model '/L_{s}'], 'Label', {_q(s)});"]
            endpoints[net].append((f"L_{s}", "LConn1", _port_at("label", "LConn1", *spot, FACE[d])))
        else:
            endpoints[net].append((f"V_{s}", "LConn1", (0, 0)))
            endpoints[ground].append((f"V_{s}", "RConn2", (0, 0)))
    if measured:
        mx, my = right + 380, top + 50 * (len(measured) - 1)
        L += [f"add_block('simulink/Signal Routing/Mux', [model '/Mux'], 'Position', "
              f"[{mx} {my - 20 * len(measured)} {mx + 5} {my + 20 * len(measured)}]);",
              f"set_param([model '/Mux'], 'Inputs', '{len(measured)}');",
              _put("simulink/Sinks/Scope", "Node voltages", mx + 80, my, "right", 40, 40),
              "wire(model, 'Mux', 'Outport1', 'Node voltages', 'Inport1');"]
        L += [f"wire(model, 'PS_{safe(n)}', 'Outport1', 'Mux', 'Inport{j + 1}');" for j, n in enumerate(measured)]

    L.append("")
    for net, ends in endpoints.items():
        L.append(f"% net {net}")
        if drawn:  # shortest links between the ports, as the wires run in the drawing
            for (b1, p1, _), (b2, p2, _) in _tree(ends):
                L.append(f"wire(model, {_q(b1)}, {_q(p1)}, {_q(b2)}, {_q(p2)});")
        else:
            # A star into the first port (chaining A->B->C through a shared port did not reliably join
            # physical networks; every line ending on one hub port does).
            hub_b, hub_p, _ = ends[0]
            for b, p, _ in ends[1:]:
                L.append(f"wire(model, {_q(b)}, {_q(p)}, {_q(hub_b)}, {_q(hub_p)});")

    nets_cell = "{" + ", ".join(f"{_q(n)}, {_q('v_' + safe(n))}" for n in measured) + "}"
    parts_cell = "{" + ", ".join(_q(p["id"]) for p in sim["parts"]) + "}"
    L += ["",
          "set_param(model, 'SimscapeLogType', 'all');  % only exists once Simscape blocks are in the model",
          *([] if drawn else ["try, Simulink.BlockDiagram.arrangeSystem(model); catch, end"]),
          "save_system(model, fullfile(here, [model '.slx']));",
          "result = struct('ok', true, 'error', '', 'nodes', struct('name', {}, 'final', {}, 'min', {}, 'max', {}), "
          "'parts', struct('name', {}, 'v_final', {}, 'v_min', {}, 'v_max', {}, 'i_final', {}, 'i_min', {}, 'i_max', {}));",
          "try",
          "    out = sim(model);",
          "    t = out.get('tout');",
          f"    window = t >= t(end) - {_num(min(sim['stop_time'] / 5, 1 / 50))};  % last period / settled part",
          f"    nets = {nets_cell};",
          "    for k = 1:2:numel(nets)",
          "        v = out.get(nets{k + 1});",
          "        result.nodes(end + 1) = struct('name', nets{k}, 'final', v(end), 'min', min(v(window)), 'max', max(v(window)));",
          "    end",
          "    lg = out.get('simlog');",
          f"    for name = {parts_cell}",
          "        try",
          "            node = lg.(matlab.lang.makeValidName(name{1}));",
          "            vn = pick(node, {'v', 'vak'}); in = pick(node, {'i', 'iak'});",
          "            tv = vn.series.time; vv = vn.series.values(vn.series.unit); iv = in.series.values(in.series.unit);",
          "            w = tv >= t(end) - (t(end) - t(1)) / 5;",
          "            result.parts(end + 1) = struct('name', name{1}, 'v_final', vv(end), 'v_min', min(vv(w)), "
          "'v_max', max(vv(w)), 'i_final', iv(end), 'i_min', min(iv(w)), 'i_max', max(iv(w)));",
          "        catch",
          "        end",
          "    end",
          "catch err",
          "    result.ok = false; result.error = err.message;",
          "end",
          "fid = fopen(fullfile(here, [model '.results.json']), 'w'); fprintf(fid, '%s', jsonencode(result)); fclose(fid);",
          "save_system(model, fullfile(here, [model '.slx']));",
          "close_system(model, 0);",
          "",
          "function put(model, src, name, cx, cy, o, w, h, show)",
          "    b = add_block(src, [model '/' name]);",
          "    set_param(b, 'Orientation', o);",
          "    if any(strcmp(o, {'up', 'down'})), [w, h] = deal(h, w); end",
          "    set_param(b, 'Position', round([cx - w/2, cy - h/2, cx + w/2, cy + h/2]));",
          "    if nargin > 8, set_param(b, 'ShowName', show); end",
          "end",
          "",
          "function wire(model, b1, p1, b2, p2)",
          "    add_line(model, port(model, b1, p1), port(model, b2, p2), 'autorouting', 'smart');",
          "end",
          "",
          "function h = port(model, b, p)",
          "    ph = get_param([model '/' b], 'PortHandles');",
          "    kind = regexprep(p, '\\d+$', ''); idx = str2double(regexprep(p, '^\\D+', ''));",
          "    h = ph.(kind)(idx);",
          "end",
          "",
          "function n = pick(node, names)",
          "    for k = 1:numel(names)",
          "        if any(strcmp(node.childIds, names{k})), n = node.(names{k}); return; end",
          "    end",
          "    error('no %s', strjoin(names, '/'));",
          "end"]
    return "\n".join(L) + "\n"


def _gate(p, x, y, o, k, drawn, centres) -> list[str]:
    """Pulse generator -> bias -> Simulink-PS converter into the gate. When placed like the drawing, the
    pulse and bias sit in a column on the left and reach a converter beside the gate through Goto/From."""
    amp, bias = GATE[p["kind"]]
    g, per = p["gate"], 1 / p["gate"]["frequency"]
    gid = f"Gate_{p['id']}"
    if drawn:
        px, py = 60, 80 + 90 * k
    else:
        px, py = x - 75, y + 80
    L = [_put("simulink/Sources/Pulse Generator", gid, px, py, "right", 30, 30),
         f"set_param([model '/' {_q(gid)}], 'Amplitude', {_q(_num(amp))}, 'Period', {_q(_num(per))}, "
         f"'PulseWidth', {_q(_num(g['width_pct']))}, 'PhaseDelay', {_q(_num(per * g['phase_deg'] / 360))});",
         _put("simulink/Math Operations/Bias", gid + "_bias", px + 70, py, "right", 40, 30),
         f"set_param([model '/' {_q(gid + '_bias')}], 'Bias', {_q(_num(bias))});",
         f"wire(model, {_q(gid)}, 'Outport1', {_q(gid + '_bias')}, 'Inport1');"]
    if not drawn:
        return L + [_put(LIB["to_ps"], gid + "_ps", px + 130, py, "right", 40, 30),
                    f"set_param([model '/' {_q(gid + '_ps')}], 'Unit', 'V');",
                    f"wire(model, {_q(gid + '_bias')}, 'Outport1', {_q(gid + '_ps')}, 'Inport1');",
                    f"wire(model, {_q(gid + '_ps')}, 'RConn1', {_q(p['id'])}, 'LConn1');"]
    tag = safe(p["id"])  # short, so the Goto/From icons can show it
    gx, gy = _port_at(p["kind"], "LConn1", x, y, o)
    d = (round((gx - x) / 29), round((gy - y) / 29))  # the way the gate points, out of the block
    back = FACE[(-d[0], -d[1])]                        # outputs facing back towards the gate
    cx, cy = gx + 35 * d[0], gy + 35 * d[1]
    fx, fy = gx + 85 * d[0], gy + 85 * d[1]
    centres += [(cx, cy), (fx, fy)]
    return L + [_put("simulink/Signal Routing/Goto", gid + "_goto", px + 140, py, "right", 50, 24),
                f"set_param([model '/' {_q(gid + '_goto')}], 'GotoTag', {_q(tag)});",
                f"wire(model, {_q(gid + '_bias')}, 'Outport1', {_q(gid + '_goto')}, 'Inport1');",
                _put("simulink/Signal Routing/From", gid + "_from", fx, fy, back, 44, 24, False),
                f"set_param([model '/' {_q(gid + '_from')}], 'GotoTag', {_q(tag)});",
                _put(LIB["to_ps"], gid + "_ps", cx, cy, back, 30, 24, False),
                f"set_param([model '/' {_q(gid + '_ps')}], 'Unit', 'V');",
                f"wire(model, {_q(gid + '_from')}, 'Outport1', {_q(gid + '_ps')}, 'Inport1');",
                f"wire(model, {_q(gid + '_ps')}, 'RConn1', {_q(p['id'])}, 'LConn1');"]
