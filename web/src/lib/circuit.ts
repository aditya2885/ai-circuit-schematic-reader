// TypeScript ports of the reader's netlist helpers (context/schematic-reader/scripts/netlist.py) and the
// server's views (server/circuit.py). Used by demo mode, which has no server to rebuild results after edits.
import type { BomRow, CircuitResult, Component, Connection } from "./types";

const SPECIAL = new Set(["unknown", "NC"]);
const TWO_PIN = new Set(["resistor", "capacitor", "inductor", "diode", "led", "fuse", "battery", "lamp",
  "voltage_source", "current_source"]);
const AUTO_NET = /^(?:[\w-]+:)?N\d+$/;

export function buildNets(components: Component[]): [string, string[]][] {
  const nets = new Map<string, string[]>();
  for (const c of components)
    for (const p of c.pins) {
      const n = p.net.trim();
      nets.set(n, [...(nets.get(n) ?? []), `${c.designator}.${p.pin}`]);
    }
  return [...nets.entries()].sort(([a], [b]) => {
    const ka = AUTO_NET.test(a) ? 1 : 0;
    const kb = AUTO_NET.test(b) ? 1 : 0;
    return ka - kb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

export function checkConnectivity(components: Component[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    const d = c.designator;
    if (d !== "unknown" && seen.has(d)) out.push(`Duplicate designator ${d}: two parts read with the same reference.`);
    seen.add(d);
    if (!c.pins.length) {
      out.push(`${d}: no pin connections were read.`);
      continue;
    }
    const unknown = c.pins.filter((p) => p.net === "unknown").length;
    if (unknown) out.push(`${d}: ${unknown} pin(s) could not be traced.`);
    if (TWO_PIN.has(c.category)) {
      if (c.pins.length !== 2) out.push(`${d} (${c.category}) has ${c.pins.length} pins listed, expected 2.`);
      else if (c.pins[0].net === c.pins[1].net && !SPECIAL.has(c.pins[0].net))
        out.push(`${d}: both pins on net ${c.pins[0].net} (shorted part or misread wire).`);
    }
  }
  if (components.length && !components.some((c) => ["battery", "voltage_source", "current_source"].includes(c.category)))
    out.push("No power source (battery or voltage/current source) was read; check whether the drawing has one the model missed.");
  for (const [net, members] of buildNets(components))
    if (!SPECIAL.has(net) && members.length === 1)
      out.push(`Net ${net} has only one connection (${members[0]}): missed wire, or it continues on another sheet/crop.`);
  return out;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

export function formatNetlist(components: Component[], source: string): string {
  const lines = [
    `# Netlist reconstructed by schematic-reader from: ${source}`,
    "# UNVERIFIED: machine-read from an image. Check against the schematic before using it.",
    "",
    "## Components",
  ];
  for (const c of components) {
    const pins = c.pins.map((p) => `${p.pin}=${p.net}`).join("  ") || "(no pins read)";
    lines.push(`${pad(c.designator, 8)} ${pad(c.category, 10)} ${pad(c.value, 10)} ${pad(c.part_number, 16)} ${pins}`);
  }
  lines.push("", "## Nets");
  for (const [net, members] of buildNets(components)) lines.push(`${net} (${members.length}): ${members.join(", ")}`);
  return lines.join("\n") + "\n";
}

export function connections(components: Component[]): Connection[] {
  return buildNets(components).map(([net, members]) => ({
    net,
    members: members.map((m) => {
      const i = m.lastIndexOf(".");
      return { designator: m.slice(0, i), pin: m.slice(i + 1) };
    }),
    flags: SPECIAL.has(net) ? [net === "unknown" ? "untraced" : "no-connect"] : members.length === 1 ? ["single connection"] : [],
  }));
}

export function bom(components: Component[]): BomRow[] {
  const groups = new Map<string, BomRow>();
  for (const c of components) {
    if (c.category === "ground") continue;
    const key = `${c.category}\u0000${c.value}\u0000${c.part_number}`;
    const row = groups.get(key) ?? { category: c.category, value: c.value, part_number: c.part_number, quantity: 0, designators: [] };
    row.quantity += 1;
    row.designators.push(c.designator);
    groups.set(key, row);
  }
  return [...groups.values()];
}

/** Rebuild everything derived from the components after an edit, as server/circuit.save_components does. */
export function applyEdit(result: CircuitResult, components: Component[], source: string): CircuitResult {
  const stale = new Set(checkConnectivity(result.components));
  const notes = result.warnings.filter((w) => !stale.has(w));
  const before = new Map(result.components.map((c) => [c.designator, JSON.stringify({ ...c, evidence: undefined })]));
  return {
    ...result,
    components: components.map((c) => {
      const changed = before.get(c.designator) !== JSON.stringify({ ...c, evidence: undefined });
      return changed ? { ...c, evidence: { level: "check", reasons: ["edited by you"], corrections: [] } } : c;
    }),
    connections: connections(components),
    warnings: [...notes, ...checkConnectivity(components)],
    netlist: formatNetlist(components, source),
    bom: bom(components),
    edited: true,
  };
}

const UNIT_WORDS: [RegExp, string][] = [
  [/\s*(?:k\s*ohms?|kilo\s*ohms?)\b/gi, "kΩ"],
  [/\s*(?:m\s*ohms?|mega\s*ohms?)\b/gi, "MΩ"],
  [/\s*ohms?\b/gi, "Ω"],
  [/\s*micro\s*farads?\b/gi, "µF"],
  [/\s*farads?\b/gi, "F"],
  [/\s*henr(?:y|ies)\b/gi, "H"],
  [/\s*volts?\b/gi, "V"],
  [/\s*amps?\b/gi, "A"],
];

export function tidyValue(text: string): string {
  let v = text.trim().replace(/[.!]+$/, "");
  for (const [re, rep] of UNIT_WORDS) v = v.replace(re, rep);
  return v.replace(/(?<=\d)\s+(?=[a-zA-ZµΩ])/g, "");
}

// Same intent rules as server/chat.py, for demo mode.
export const EDIT_RE = /\b(?:change|set|make|update|replace|correct|fix)\b(.*?)\b(?:to|=|as|into)\s+([^,;\n]+?)\s*[.!]?\s*$/i;
export const BUILD_RE = /\b(?:generate|build|create|make|run|rebuild|regenerate|simulate)\b.*\b(?:matlab|simulink|simscape|model|simulation)\b|\bsimulate\b/i;
export const QUESTION_RE = /\b(how|what|why|explain|describe)\b/i;
export const OPEN_RE = /\b(?:open|show|launch|view)\b.*\b(?:matlab|simulink|model)\b/i;

export function findPart(text: string, components: Component[]): Component | null {
  const hits = components.filter(
    (c) => c.designator !== "unknown" && new RegExp(`(?<![\\w])${c.designator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(text),
  );
  return hits.length === 1 ? hits[0] : null;
}
