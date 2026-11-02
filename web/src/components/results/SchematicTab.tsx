import { Info } from "lucide-react";
import { useState } from "react";
import { cn, labelOf } from "../../lib/utils";
import { ImageViewer, type Overlay } from "../ui/ImageViewer";
import { Tabs } from "../ui/primitives";
import { EvidenceBadge, type TabProps } from "./shared";

export function SchematicTab({ service, analysis, result, tall }: TabProps) {
  const traced = analysis.files.find((f) => f.name === "schematic.trace.png");
  const [view, setView] = useState<"traced" | "original">(traced ? "traced" : "original");
  const [hover, setHover] = useState<string | null>(null);
  const [boxes, setBoxes] = useState(true);

  const layout = result.layout;
  const byDesignator = new Map(result.components.map((c) => [c.designator, c]));
  // Part boxes are in the reader's prepared-image frame, which is the frame of the trace image.
  const overlays: Overlay[] =
    view === "traced" && layout && boxes
      ? Object.entries(layout.parts).map(([id, b]) => {
          const level = byDesignator.get(id)?.evidence?.level;
          return { id, label: id, ...b, tone: level === "check" ? "warn" : level === "model" ? "muted" : "accent" };
        })
      : [];
  const src = view === "traced" && traced ? `${service.fileUrl(analysis.id, traced.name)}?v=${analysis.updated}` : analysis.file.url;

  return (
    <div className={cn("grid gap-3", tall ? "lg:grid-cols-[1fr_280px]" : "md:grid-cols-[1fr_240px]")}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={view}
            onChange={setView}
            tabs={[
              { id: "traced" as const, label: "Traced wires" },
              { id: "original" as const, label: "Original" },
            ].filter((t) => t.id === "original" || traced)}
          />
          {view === "traced" && layout && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} className="accent-[var(--accent)]" />
              Highlight parts
            </label>
          )}
        </div>
        <ImageViewer src={src} alt={analysis.file.name} overlays={overlays} frame={layout?.size} highlight={hover} onHover={setHover} className={tall ? "h-[62vh]" : "h-[380px]"} />
        <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-faint">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {view === "traced"
            ? "The reader's prepared image: each colour is one net traced from the pixels, and each box is where a part was located. Hover a part in the list to find it."
            : layout
              ? "Your uploaded image. Part boxes are shown on the traced view, whose frame matches the reader's coordinates."
              : "Your uploaded image."}
        </p>
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[12px] font-medium text-muted">
          Detected parts <span className="text-faint">· {result.components.length}</span>
        </div>
        <ul className={cn("overflow-y-auto p-1.5", tall ? "max-h-[58vh]" : "max-h-[360px]")}>
          {result.components.map((c) => {
            const placed = !!layout?.parts[c.designator];
            return (
              <li key={c.designator + c.category}>
                <button
                  onMouseEnter={() => setHover(c.designator)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(c.designator)}
                  onBlur={() => setHover(null)}
                  onClick={() => placed && setView("traced")}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2", hover === c.designator && "bg-surface-2")}
                >
                  <span className="w-12 shrink-0 truncate font-mono text-[12.5px] font-semibold">{c.designator}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                    {labelOf(c.category)} {c.value !== "unknown" && <span className="text-fg">{c.value}</span>}
                  </span>
                  {placed ? <EvidenceBadge evidence={c.evidence} /> : <span className="text-[11px] text-faint" title="The wire tracer did not place this part">no box</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
