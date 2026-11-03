import { AlertTriangle, Grid3x3, Rows3 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Badge, EmptyState, Tabs } from "../ui/primitives";
import { Panel, Table, type TabProps } from "./shared";

const netTone = (net: string) => (/^(gnd|0|vss|ground)$/i.test(net) ? "text-info" : /^[+-]?\d|^v(cc|dd|in|\+)|^\+/i.test(net) ? "text-warn" : "text-ok");

export function ConnectionsTab({ result, tall }: TabProps) {
  const [view, setView] = useState<"nets" | "matrix">("nets");
  const nets = result.connections;
  const parts = result.components;
  if (!nets.length) return <EmptyState icon={<Rows3 />} title="No connections">No pin was connected to a net.</EmptyState>;

  const flagged = nets.filter((n) => n.flags.length).length;
  const warnings = result.warnings.filter((w) => !w.startsWith("Wire tracing"));
  const tracing = result.warnings.find((w) => w.startsWith("Wire tracing"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onChange={setView} tabs={[
          { id: "nets" as const, label: "Nets", icon: <Rows3 className="size-3.5" />, count: nets.length },
          { id: "matrix" as const, label: "Pin matrix", icon: <Grid3x3 className="size-3.5" /> },
        ]} />
        <span className="ml-auto text-[12px] text-muted">
          {tracing ? tracing : "Connections are the vision model's reading (no wire tracing)."}
        </span>
      </div>

      {view === "nets" ? (
        <Panel title={<>Electrical nets {flagged > 0 && <Badge tone="warn" className="ml-1.5">{flagged} flagged</Badge>}</>}>
          <Table className={tall ? "max-h-[56vh]" : "max-h-[380px]"} head={<><th>Net</th><th>Connected pins</th><th className="text-right">Pins</th><th>Notes</th></>}>
            {nets.map((n) => (
              <tr key={n.net} className="hover:bg-surface-2/60">
                <td className={cn("font-mono text-[13px] font-semibold whitespace-nowrap", n.flags.length ? "text-warn" : netTone(n.net))}>{n.net}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {n.members.map((m) => (
                      <span key={`${m.designator}.${m.pin}`} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px]">
                        {m.designator}<span className="text-faint">.{m.pin}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-right font-mono tabular text-muted">{n.members.length}</td>
                <td>{n.flags.map((f) => <Badge key={f} tone="warn">{f}</Badge>)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : (
        <Panel title="Which pin of each part sits on each net">
          <div className={cn("overflow-auto", tall ? "max-h-[56vh]" : "max-h-[380px]")}>
            <table className="border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface-2">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-line bg-surface-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-faint">Part</th>
                  {nets.map((n) => (
                    <th key={n.net} className={cn("border-b border-line px-2 py-2 font-mono text-[11.5px] font-semibold whitespace-nowrap", n.flags.length ? "text-warn" : netTone(n.net))}>{n.net}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parts.map((c, i) => (
                  <tr key={c.designator + i} className="hover:bg-surface-2/60">
                    <td className="sticky left-0 border-b border-r border-line bg-surface px-3 py-1.5 font-mono font-semibold whitespace-nowrap">{c.designator}</td>
                    {nets.map((n) => {
                      const pins = n.members.filter((m) => m.designator === c.designator).map((m) => m.pin);
                      return (
                        <td key={n.net} className="border-b border-line px-2 py-1.5 text-center">
                          {pins.length > 0 && <span className="inline-flex min-w-6 items-center justify-center rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">{pins.join(",")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {warnings.length > 0 && (
        <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warn" />Reader notes and warnings <span className="text-faint">· {warnings.length}</span></span>}>
          <ul className="divide-y divide-line">
            {warnings.map((w, i) => (
              <li key={i} className="px-3.5 py-2 text-[12.5px] leading-relaxed text-muted">{w}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
