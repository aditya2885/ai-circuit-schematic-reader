"""Output schemas for the schematic-reader skill.

SchematicAnalysis is what the model must produce for a schematic.
InputCheck is the gatekeeper result used to reject anything that is not a schematic.
Keep nesting shallow: small vision models follow flat schemas more reliably.
"""
from typing import Literal

from pydantic import BaseModel, Field

UNKNOWN = 'Use "unknown" if not readable.'


class PinConnection(BaseModel):
    pin: str = Field(description="Pin number or name as printed (1, VIN, FB). Passives without numbers: 1/2. "
                                 "Diodes/LEDs: A/K. Thyristors/SCRs: A/K/G. BJTs: B/C/E. MOSFETs: G/D/S.")
    net: str = Field(description="Net label or power symbol name this pin connects to (GND, +5V, SDA). "
                                 "Unlabelled wires: N1, N2, ... used consistently for every pin on the same wire. "
                                 "'NC' for no-connect. 'unknown' if the wire cannot be traced.")


class Component(BaseModel):
    designator: str = Field(description=f"Reference designator of ONE part, e.g. R1, U3. Never a range. {UNKNOWN}")
    category: Literal[
        "resistor", "capacitor", "inductor", "diode", "led", "transistor",
        "mosfet", "thyristor", "ic", "connector", "crystal", "fuse", "switch",
        "battery", "voltage_source", "current_source", "lamp", "meter", "ground", "other",
    ]
    value: str = Field(description=f"Value with units, e.g. 10k, 100nF, 4.7uH. {UNKNOWN}")
    part_number: str = Field(description=f"Part number exactly as printed. {UNKNOWN}")
    role: str = Field(description="Short purpose, e.g. 'decoupling', 'I2C pull-up', 'buck regulator'.")
    pins: list[PinConnection] = Field(description="Every visible pin of this part and the net it connects to.")


class PowerRail(BaseModel):
    name: str = Field(description="Net name as labelled, e.g. VBAT, +5V, 3V3.")
    voltage: str = Field(description=f"Nominal voltage, e.g. 5V, 7.4V. {UNKNOWN}")
    source: str = Field(description="Component or connector that supplies this rail, e.g. U2 (LM2596).")


class Connector(BaseModel):
    designator: str = Field(description=f"Connector designator, e.g. J1. {UNKNOWN}")
    signals: list[str] = Field(description="Pin/net names carried by the connector.")
    purpose: str = Field(description="What the connector is for, e.g. 'battery input', 'SWD debug'.")


class FunctionalBlock(BaseModel):
    name: str = Field(description="Block name, e.g. '5V buck converter', 'motor driver'.")
    purpose: str = Field(description="One sentence on what the block does.")
    key_components: list[str] = Field(description="Designators of the main parts in this block.")


class Node(BaseModel):
    name: str = Field(description="Net name: the label if there is one (GND, +5V, Vout), else N1, N2, ...")
    joins: str = Field(description="Which part ends this one continuous wire touches, e.g. "
                                   "'B1 +, C1 top plate, R1 left end'. A wire interrupted by a part is two nodes.")


# Field order matters: the model writes fields in this order, so it traces the wires (nodes, topology)
# before it commits to pin-to-net connections.
class SchematicAnalysis(BaseModel):
    circuit_type: str = Field(description="Short classification, e.g. 'buck converter', 'RC circuit', 'MCU board'.")
    summary: str = Field(description="2-4 sentence plain-language description of what the circuit does.")
    drawing_style: Literal["printed", "hand_drawn"] = Field(description="'hand_drawn' ONLY for visibly pen/pencil/"
                                                                         "whiteboard strokes with wobbly lines; clean, "
                                                                         "uniform, computer-rendered figures (textbook "
                                                                         "or datasheet images) are 'printed'.")
    nodes: list[Node] = Field(description="Every electrical node: follow each wire from end to end and list the "
                                          "part terminals it reaches. Parts between two different nodes are in series "
                                          "only if nothing else touches the node between them.")
    topology: str = Field(description="How the parts are arranged, derived from the nodes: which are in series, which "
                                      "in parallel, e.g. 'R1 and R2 in series; that pair and C1 both across B1'.")
    components: list[Component]
    power_rails: list[PowerRail]
    connectors: list[Connector]
    functional_blocks: list[FunctionalBlock]
    interfaces: list[str] = Field(description="Interfaces present, e.g. I2C, SPI, UART, USB, SWD, CAN, PWM.")
    design_notes: list[str] = Field(description="Engineering observations, inferences, or possible issues. One sentence each.")
    unreadable_or_uncertain: list[str] = Field(description="Anything that could not be read or is a guess, with its location.")
    confidence: Literal["low", "medium", "high"]


class MissingParts(BaseModel):
    missing: list[Component] = Field(description="Drawn parts that were not in the given list. Empty if none.")


class SourceCheck(BaseModel):
    kind: Literal["dc_voltage", "ac_voltage", "battery", "current_source", "none"]
    label: str = Field(description="The source's label as written, e.g. V, Vs, E, B1.")
    value: str = Field(description=f"Value with units, e.g. 12V, 230V 50Hz. {UNKNOWN}")
    positive_net: str = Field(description="Net the + terminal connects to, from the given list.")
    negative_net: str = Field(description="Net the - terminal connects to, from the given list.")


class InputCheck(BaseModel):
    image_type: Literal[
        "circuit_schematic", "pcb_layout", "block_diagram", "photo",
        "datasheet_or_text", "other",
    ] = Field(description="What the image actually shows.")
    is_readable: bool = Field(description="True if component labels and wires are legible enough to analyse.")
    focus_is_relevant: bool = Field(description="True if there is no focus hint, or the hint only names a part, "
                                                "section or property of this circuit. False for any other request.")
    reason: str = Field(description="One short sentence explaining the classification.")
