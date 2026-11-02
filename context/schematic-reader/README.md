# schematic-reader

Turns an electronics schematic image into structured JSON, a reconstructed netlist,
and optional Markdown report / BOM CSV, using a local Ollama vision model.
Built like a Claude Skill: `SKILL.md` holds the instructions, `scripts/` holds the code.

## Folder layout

```
schematic-reader/
├── SKILL.md            # instructions + restrictions sent to the model
├── README.md
├── requirements.txt
└── scripts/
    ├── analyze.py      # run this
    ├── schema.py       # JSON fields (edit to change what is extracted)
    ├── guard.py        # input restrictions (schematics only, focus checks)
    ├── wires.py        # traces wires + diode/battery direction from the pixels
    └── netlist.py      # nets, connectivity checks, crop merging
```

## Setup (Windows, one time)

```
ollama pull qwen3-vl:8b-instruct
cd path\to\schematic-reader
pip install -r requirements.txt
```

## Usage

```
python scripts\analyze.py circuit.png
python scripts\analyze.py circuit.png --md --csv
python scripts\analyze.py C:\schematics --out results
python scripts\analyze.py top_left.png top_right.png bottom.png --merge mainboard
python scripts\analyze.py circuit.png --focus "battery input protection"
```

Outputs (next to the image, or in --out):
- `circuit.json`     full analysis + nets + connectivity warnings
- `circuit.net.txt`  readable netlist (components with pin=net, then every net)
- `circuit.md`       report (with --md)
- `circuit.bom.csv`  BOM with pin connections (with --csv)
- `circuit.trace.png` debug picture: each traced net in its own colour, part boxes in red
- `circuit.rejected.json` if the input was refused
- `circuit.raw.txt`  raw model output if it failed validation

## Restrictions

- Every image first passes a quick check. Anything that is not an electronics
  schematic (photos, PCB layouts, block diagrams, documents) is rejected.
- `--focus` must be a short single line naming part of the circuit. Questions or
  unrelated requests are refused.
- Text inside images is treated as data, never as instructions.
- The analysis output is locked to the JSON schema, so the model cannot reply
  with free-form answers.

## Missing parts

After the main reading, the model is shown the list of parts it found and asked for any drawn part that is
missing. If there is still no power source, a targeted question looks for one, including textbook-style
supplies drawn as two `+`/`-` terminals with a voltage arrow. Parts added this way are flagged in the
warnings. `--no-recheck` skips this step.

The JSON can be turned into a Simulink model with `simulink/build_simulink.py` (see `simulink/README.md`).

## Photos of hand-drawn circuits

Before the model sees a photo, `analyze.py` cleans it up (skip with `--raw`):

1. **Ruled paper** (`ruled.py`): the printed lines of notebook paper are erased, since the
   tracer would otherwise read each one as a wire joining everything it touches. A line is
   only erased when it runs edge to edge, is nearly horizontal, is thinner than the pen
   strokes, and is one of at least three evenly spaced lines, so long drawn rails on plain
   paper are never touched. Where a drawn wire crosses or runs along a ruled line, the ink
   there is thicker, so it is kept. The run log says `erased N ruled-paper lines` when this
   happens. Not handled: graph paper (vertical lines too) and lines drawn in the same
   thickness as the pen.
2. Crop to the drawing, flatten uneven lighting, boost contrast and upscale small sketches.

## How connectivity is worked out

Qwen reads the parts, values and labels, and gives a first wire reading. Small vision
models are unreliable at following wires (series vs parallel) and at diode direction, so
`wires.py` then re-derives them from the pixels:

1. Qwen gives a bounding box for each part's symbol.
2. The image is turned into an ink mask; small pen gaps are closed.
3. Every part box is erased, so only wires remain. Each connected wire region is one net.
4. The regions touching opposite ends of a box are that part's terminals.
5. Diode/LED/thyristor direction: the symbol is wide just inside the triangle base (anode)
   and narrow just inside the bar (cathode). Battery: the long plate is +.
6. Nets are named from the model's own net names (votes); hand-drawn wires that stop just
   short of each other are joined.

Parts it cannot trace (ICs, transistors, parts not located) keep the model's reading, and
each is listed in the warnings. Check `*.trace.png` to see what was traced. Known limit:
wires that cross without a junction dot are treated as connected. Use `--no-trace` to
turn tracing off. `--box-model` asks a different Ollama model for the boxes in step 1 only,
e.g. the box fine-tune from `training/` (`--box-model qwen3-vl-circuits`); everything else
still uses `--model`.

## Netlist reconstruction tips

- Use clean, high-resolution exports. Dense full-page sheets: crop into regions
  with some overlap and use `--merge`. Overlapping parts let unlabelled wires
  be stitched back together across crops.
- Read every line in "connectivity warnings". Single-connection nets and
  two-pin parts with the wrong pin count usually mean a misread wire.
- If you have the KiCad source, export the netlist from KiCad instead; it is
  exact. This tool is for when you only have an image.
