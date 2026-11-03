import { Boxes, Cable, Cpu, FileCode2, FolderDown, Image as ImageIcon, Maximize2, Package } from "lucide-react";
import { useState } from "react";
import type { CircuitService } from "../../lib/service";
import type { Analysis } from "../../lib/types";
import { useAnalysis } from "../../lib/useAnalysis";
import { IconButton, Modal, ModalHeader, Tabs, type Tone } from "../ui/primitives";
import { ComponentsTab } from "./ComponentsTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { BomTab, NetlistTab } from "./NetlistTab";
import { SchematicTab } from "./SchematicTab";
import { SimulinkTab } from "./SimulinkTab";

type TabId = "schematic" | "components" | "connections" | "netlist" | "bom" | "simulink";

function Body({ service, analysis, tab, tall }: { service: CircuitService; analysis: Analysis; tab: TabId; tall?: boolean }) {
  const { setAnalysis } = useAnalysis(service, analysis.id);
  const result = analysis.result!;
  const props = { service, analysis, result, tall, onAnalysis: setAnalysis };
  switch (tab) {
    case "schematic": return <SchematicTab {...props} />;
    case "components": return <ComponentsTab {...props} />;
    case "connections": return <ConnectionsTab {...props} />;
    case "netlist": return <NetlistTab {...props} />;
    case "bom": return <BomTab {...props} />;
    case "simulink": return <SimulinkTab {...props} />;
  }
}

export function ResultsPanel({ service, analysis }: { service: CircuitService; analysis: Analysis }) {
  const [tab, setTab] = useState<TabId>("components");
  const [expanded, setExpanded] = useState(false);
  const r = analysis.result!;
  const flagged = r.components.filter((c) => c.evidence?.level === "check").length;
  const sim = analysis.simulink;
  const simTone: Tone = sim.status === "done" ? (sim.stale || sim.check.some((l) => l.startsWith("FAIL")) ? "warn" : "ok") : sim.status === "error" ? "err" : sim.status === "running" ? "accent" : "neutral";
  const bundle = service.bundleUrl(analysis.id);

  const tabs = [
    { id: "schematic" as const, label: "Schematic", icon: <ImageIcon className="size-3.5" /> },
    { id: "components" as const, label: "Components", icon: <Boxes className="size-3.5" />, count: r.components.length, tone: (flagged ? "warn" : "neutral") as Tone },
    { id: "connections" as const, label: "Connections", icon: <Cable className="size-3.5" />, count: r.connections.length },
    { id: "netlist" as const, label: "Netlist", icon: <FileCode2 className="size-3.5" /> },
    { id: "bom" as const, label: "BOM", icon: <Package className="size-3.5" />, count: r.bom.reduce((n, b) => n + b.quantity, 0) },
    { id: "simulink" as const, label: "MATLAB / Simulink", icon: <Cpu className="size-3.5" />, count: sim.status === "idle" ? undefined : sim.status === "running" ? "…" : sim.status === "error" ? "!" : sim.stale ? "old" : "✓", tone: simTone },
  ];

  const bar = <Tabs tabs={tabs} value={tab} onChange={setTab} className="min-w-0" />;
  const zip = bundle && (
    <a href={bundle} download title="Download all files (.zip)" aria-label="Download all files (.zip)"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg">
      <FolderDown className="size-4" />
    </a>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface-2/40 p-2 sm:p-2.5">
      <div className="flex items-start gap-2 pb-2">
        <div className="min-w-0 flex-1">{bar}</div>
        {zip}
        <IconButton label="Open results full screen" onClick={() => setExpanded(true)} className="shrink-0"><Maximize2 className="size-4" /></IconButton>
      </div>
      <Body service={service} analysis={analysis} tab={tab} />

      <Modal open={expanded} onClose={() => setExpanded(false)} label="Analysis results" className="flex h-[94vh] max-w-[1400px] flex-col">
        <ModalHeader title={r.circuit_type || "Analysis results"} subtitle={analysis.file.name} onClose={() => setExpanded(false)}>{zip}</ModalHeader>
        <div className="border-b border-line px-4 py-2">{bar}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4"><Body service={service} analysis={analysis} tab={tab} tall /></div>
      </Modal>
    </div>
  );
}
