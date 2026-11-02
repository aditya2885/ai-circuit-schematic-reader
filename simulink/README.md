# simulink

Turns the schematic reader's JSON into a MATLAB Simulink / Simscape Electrical model with every
read value entered, simulates it, and checks the result against an independent hand calculation.

```
image --(context/schematic-reader)--> results/<name>.json --(this folder)--> simulink/out/<name>/<name>_sim.slx
```

## Usage

```
python simulink/build_simulink.py results/handwritten.json --run
```

Writes to `simulink/out/<name>/`:

| File | What it is |
|---|---|
| `<name>.sim.json` | Normalised description: block per part, SI values, nets, ground, gate timing, and every assumption. **Edit this** to fix a value, then rebuild from it. |
| `build_<name>.m` | Generated MATLAB script that builds the model. Can be run by hand: `run('build_<name>.m')`. |
| `<name>_sim.slx` | The Simulink model. |
| `<name>_sim.results.json` | Simulated node voltages and each part's voltage/current. |
| `<name>.check.txt` | PASS/FAIL against the hand calculation. |

Rebuild after editing values: `python simulink/build_simulink.py simulink/out/<name>/<name>.sim.json --run`

`matlab -batch "run('simulink/inspect_models.m')"` prints the values entered in each saved model and
saves a picture of each diagram.

## Stages

1. `normalize.py`: reader JSON -> `.sim.json`. Parses values (`5Ω`, `3μF`, `4.7k`, `2.2 mH`, `230V 50Hz`),
   maps each part to a block, picks the ground (ground symbol, else a GND-like net, else the source's
   `-` terminal) and fills anything the drawing does not give with a default that is listed under `assumed`.
2. `generate.py`: `.sim.json` -> MATLAB script (blocks, parameters with units, wiring, a voltage sensor and
   scope on every node, Simscape logging).
3. `build_simulink.py --run`: runs MATLAB, then `check()` compares with `dcsolve.py` (modified nodal analysis
   of the DC steady state) or, for a switching bridge, with the expected square-wave amplitude.

## Block mapping (R2025b)

| Reader category | Block | Ports (verified by simulation) |
|---|---|---|
| resistor, other 2-pin load | `fl_lib` Resistor | LConn1, RConn1 |
| capacitor / inductor | `fl_lib` Capacitor / Inductor | LConn1, RConn1 |
| battery, voltage_source | `fl_lib` DC (or AC) Voltage Source | LConn1 = +, RConn1 = - |
| current_source | `fl_lib` DC Current Source | LConn1, RConn1 (direction not yet verified) |
| diode, led | `ee_lib` Diode | LConn1 = anode, RConn1 = cathode |
| thyristor | `ee_lib` Thyristor (Piecewise Linear), or GTO | LConn1 = gate (physical signal), RConn1 = A, RConn2 = K |
| lamp | `ee_lib` Incandescent Lamp | LConn1, RConn1 |
| ground | Electrical Reference | |

Not mapped yet (reported as issues and left out): transistors, MOSFETs, ICs, switches, meters,
connectors, crystals, fuses.

## Defaults and assumptions (always listed in the output)

- Unreadable values: R 1 kΩ, load 10 Ω, C 1 µF, L 1 mH, DC source 10 V, AC 230 V RMS 50 Hz.
- Thyristors fed from DC are modelled as gate-turn-off thyristors (GTO): a real SCR on DC never turns off
  without a commutation circuit, which textbook bridge drawings leave out. Use `--thyristor-model thyristor`
  for the plain SCR model.
- Gate timing is never in a drawing: bridge switches fire as a 50 Hz square-wave inverter (diagonal pairs
  180° apart). Change `gate` in the `.sim.json`.
- Lamps use the Incandescent Lamp block's default ratings (12 V).

## Known limits

- Blocks are placed like the drawing when the reader JSON has a `layout` entry (written by `analyze.py`,
  or added later with `add_layout.py`); otherwise the diagram is auto-arranged. Wires are routed by
  Simulink, so they follow the shortest links rather than the drawn wire paths.
- Non-linear circuits get a hand-calculation check only where it is exact (switching bridge amplitude, or a
  lamp/diode sitting directly across the source); otherwise the simulated values are reported.
