# H-bridge

Source: `inverter.png` (printed)  
Confidence: **high**

This is a full H-bridge circuit using four thyristors (Th1, Th2, Th3, Th4) and four antiparallel diodes (D1, D2, D3, D4) to control the direction and magnitude of current through a load. The input voltage V is applied across the top and bottom rails. The load is connected between the two midpoint nodes of the H-bridge. Current flows through the load in one direction when Th1 and Th4 are conducting, and in the opposite direction when Th2 and Th3 are conducting. The diodes provide a freewheeling path for inductive loads.

## Topology (as described by the model)

The H-bridge consists of two legs. The top leg has Th1 and Th3, with D1 and D3 as antiparallel diodes. The bottom leg has Th2 and Th4, with D2 and D4 as antiparallel diodes. The load is connected between the midpoints of the two legs (N3 and N4). The input voltage V is applied across the top and bottom rails. The diodes provide a freewheeling path for inductive loads.

## Nodes (as described by the model)

- **+V**: V+ terminal, D1 anode, Th1 anode, Th3 anode, D3 anode
- **-V**: V- terminal, D4 cathode, Th4 cathode, Th2 cathode, D2 cathode
- **N1**: D1 cathode, Th1 cathode, Th3 cathode, D3 cathode
- **N2**: D2 anode, Th2 anode, Th4 anode, D4 anode
- **N3**: Th1 cathode, Th3 cathode, Load + terminal
- **N4**: Th2 cathode, Th4 cathode, Load - terminal
- **N5**: Load + terminal, Load - terminal

## Functional blocks

- **H-bridge**: Controls the direction and magnitude of current through a load using four thyristors and four antiparallel diodes. (Th1, Th2, Th3, Th4, D1, D2, D3, D4, Load)

## Components

| Ref | Type | Value | Part number | Role | Pins |
|---|---|---|---|---|---|
| D1 | diode | unknown | unknown | antiparallel diode | A→N3, K→+V |
| D2 | diode | unknown | unknown | antiparallel diode | A→-V, K→N4 |
| D3 | diode | unknown | unknown | antiparallel diode | A→N4, K→+V |
| D4 | diode | unknown | unknown | antiparallel diode | A→-V, K→N3 |
| Th1 | thyristor | unknown | unknown | switch | A→+V, K→N3, G→G_Th1 |
| Th2 | thyristor | unknown | unknown | switch | A→N4, K→-V, G→G_Th2 |
| Th3 | thyristor | unknown | unknown | switch | A→+V, K→N4, G→G_Th3 |
| Th4 | thyristor | unknown | unknown | switch | A→N3, K→-V, G→G_Th4 |
| Load | other | unknown | unknown | load | 1→N3, 2→N4 |
| V | voltage_source | unknown | unknown | supply | +→+V, -→-V |

## Nets

- **+V**: D1.K, D3.K, Th1.A, Th3.A, V.+
- **-V**: D2.A, D4.A, Th2.K, Th4.K, V.-
- **G_Th1**: Th1.G
- **G_Th2**: Th2.G
- **G_Th3**: Th3.G
- **G_Th4**: Th4.G
- **N3**: D1.A, D4.K, Th1.K, Th4.A, Load.1
- **N4**: D2.K, D3.A, Th2.A, Th3.K, Load.2

## Design notes

- This is a full H-bridge circuit. The thyristors are typically controlled by a microcontroller or other logic circuit to switch the current direction through the load.

## Connectivity warnings (check these on the schematic)

- V (dc_voltage, unknown): source added by a targeted second look; verify it.
- Wire tracing: 10/10 parts traced from the drawing, 8 nets, 8 part(s) corrected.
- D1: pins re-traced from the wires: A +V -> N3, K N1 -> +V
- D2: pins re-traced from the wires: A N2 -> -V, K -V -> N4
- D3: pins re-traced from the wires: A +V -> N4, K N4 -> +V
- D4: pins re-traced from the wires: A N3 -> -V, K -V -> N3
- Th1: pins re-traced from the wires: G unknown -> G_Th1
- Th2: pins re-traced from the wires: G unknown -> G_Th2
- Th3: pins re-traced from the wires: G unknown -> G_Th3
- Th4: pins re-traced from the wires: G unknown -> G_Th4
- Net G_Th1 has only one connection (Th1.G): missed wire, or it continues on another sheet/crop.
- Net G_Th2 has only one connection (Th2.G): missed wire, or it continues on another sheet/crop.
- Net G_Th3 has only one connection (Th3.G): missed wire, or it continues on another sheet/crop.
- Net G_Th4 has only one connection (Th4.G): missed wire, or it continues on another sheet/crop.
