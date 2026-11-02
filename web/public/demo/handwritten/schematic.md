# RC circuit

Source: `handwritten.jpeg` (hand drawn)  
Confidence: **high**

A simple RC circuit with a 5V battery, a 3μF capacitor, and two resistors (5Ω and 2Ω) arranged in a series-parallel configuration. The capacitor is in parallel with the 5Ω resistor, and this combination is in series with the 2Ω resistor, all connected to the battery.

## Topology (as described by the model)

The 5Ω resistor and 3μF capacitor are in parallel with each other, and this parallel combination is in series with the 2Ω resistor, all connected across the 5V battery.

## Nodes (as described by the model)

- **B1+**: B1 +, R1 left end, C1 top plate
- **B1-**: B1 -, R2 left end, C1 bottom plate
- **R1_right**: R1 right end, R2 left end
- **R2_right**: R2 right end, B1 -

## Components

| Ref | Type | Value | Part number | Role | Pins |
|---|---|---|---|---|---|
| B1 | voltage_source | 5V | unknown | power source | +→B1+, -→R2_right |
| R1 | resistor | 5Ω | unknown | series resistor | 1→B1+, 2→R1_right |
| C1 | capacitor | 3μF | unknown | filtering or timing | 1→B1+, 2→R2_right |
| R2 | resistor | 2Ω | unknown | series resistor | 1→R1_right, 2→R2_right |

## Nets

- **B1+**: B1.+, R1.1, C1.1
- **R1_right**: R1.2, R2.1
- **R2_right**: B1.-, C1.2, R2.2

## Connectivity warnings (check these on the schematic)

- Wire tracing: 3/4 parts traced from the drawing, 3 nets, 1 part(s) corrected.
- B1: its box overlaps C1's, so it is probably misplaced; kept the model's reading.
- B1: net B1- matched to traced wire R2_right.
- C1: pins re-traced from the wires: 2 B1- -> R2_right
