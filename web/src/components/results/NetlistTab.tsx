import { FileText, Package, Sheet } from "lucide-react";
import type { ReactNode } from "react";
import { cn, downloadText, labelOf } from "../../lib/utils";
import { Button, CopyButton, EmptyState } from "../ui/primitives";
import { DownloadLink, Panel, Table, type TabProps } from "./shared";

/** Colours the reader's netlist format: comments, section headers, designator/type/value/part, pin=net. */
function highlight(line: string): ReactNode {
  if (line.startsWith("## ")) return <span className="font-semibold text-accent">{line}</span>;
  if (line.startsWith("#")) return <span className="text-faint italic">{line}</span>;
  const net = line.match(/^(\S+) \((\d+)\): (.*)$/);
  if (net)
    return (
      <>
        <span className="font-semibold text-ok">{net[1]}</span> <span className="text-faint">({net[2]}):</span>{" "}
        {net[3].split(", ").map((m, i) => {
          const [d, p] = [m.slice(0, m.lastIndexOf(".")), m.slice(m.lastIndexOf(".") + 1)];
          return <span key={i}>{i > 0 && <span className="text-faint">, </span>}<span className="text-fg">{d}</span><span className="text-faint">.{p}</span></span>;
        })}
      </>
    );
  const comp = line.match(/^(\S+)(\s+)(\S+)(\s+)(\S+)(\s+)(\S+)(\s+)(.*)$/);
  if (comp)
    return (
      <>
        <span className="font-semibold text-accent-strong">{comp[1]}</span>{comp[2]}
        <span className="text-info">{comp[3]}</span>{comp[4]}
        <span className={comp[5] === "unknown" ? "text-faint" : "text-warn"}>{comp[5]}</span>{comp[6]}
        <span className="text-faint">{comp[7]}</span>{comp[8]}
        {comp[9].split(/(\s+)/).map((t, i) => {
          const eq = t.indexOf("=");
          return eq > 0 ? <span key={i}><span className="text-faint">{t.slice(0, eq)}=</span><span className={t.endsWith("=unknown") ? "text-err" : "text-ok"}>{t.slice(eq + 1)}</span></span> : t;
        })}
      </>
    );
  return line;
}

export function NetlistTab({ service, analysis, result, tall }: TabProps) {
  const base = analysis.file.name.replace(/\.[^.]+$/, "").replace(/\s*\(page 1\)$/, "");
  const lines = result.netlist.replace(/\n$/, "").split("\n");
  if (!result.netlist) return <EmptyState icon={<FileText />} title="No netlist">The reader did not write a netlist for this analysis.</EmptyState>;
  return (
    <Panel
      title={<span className="flex items-center gap-2">Netlist <span className="font-mono text-[11.5px] font-normal text-faint">{base}.net.txt</span></span>}
      actions={
        <>
          <CopyButton text={result.netlist} />
          <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => downloadText(result.netlist, `${base}.net.txt`)}>Download</Button>
          {analysis.files.some((f) => f.name === "schematic.json") && (
            <DownloadLink href={service.fileUrl(analysis.id, "schematic.json")}>Circuit JSON</DownloadLink>
          )}
        </>
      }
    >
      <div className={cn("overflow-auto bg-surface-2/50", tall ? "max-h-[62vh]" : "max-h-[420px]")}>
        <pre className="py-3 font-mono text-[12.5px] leading-[1.75]">
          {lines.map((l, i) => (
            <div key={i} className="flex hover:bg-surface-3/60">
              <span className="w-12 shrink-0 select-none pr-4 text-right tabular text-faint/70">{i + 1}</span>
              <span className="pr-4 whitespace-pre">{highlight(l)}</span>
            </div>
          ))}
        </pre>
      </div>
    </Panel>
  );
}

export function BomTab({ analysis, result, tall }: TabProps) {
  const base = analysis.file.name.replace(/\.[^.]+$/, "").replace(/\s*\(page 1\)$/, "");
  const csv = ["quantity,type,value,part_number,designators", ...result.bom.map((r) => [r.quantity, labelOf(r.category), r.value, r.part_number, r.designators.join(" ")].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n") + "\n";
  const total = result.bom.reduce((n, r) => n + r.quantity, 0);
  if (!result.bom.length) return <EmptyState icon={<Package />} title="Nothing to list">No parts other than grounds were read.</EmptyState>;
  return (
    <Panel
      title={<span>Bill of materials <span className="font-normal text-faint">· {result.bom.length} line{result.bom.length === 1 ? "" : "s"}, {total} part{total === 1 ? "" : "s"}</span></span>}
      actions={
        <>
          <CopyButton text={csv} label="Copy CSV" />
          <Button size="sm" variant="ghost" icon={<Sheet className="size-3.5" />} onClick={() => downloadText(csv, `${base}.bom.csv`, "text/csv")}>Download CSV</Button>
        </>
      }
    >
      <Table className={tall ? "max-h-[62vh]" : "max-h-[420px]"} head={<><th className="w-14 text-right">Qty</th><th>Type</th><th>Value</th><th>Part number</th><th>Designators</th></>}>
        {result.bom.map((r, i) => (
          <tr key={i} className="hover:bg-surface-2/60">
            <td className="text-right font-mono text-[13px] font-semibold tabular">{r.quantity}</td>
            <td>{labelOf(r.category)}</td>
            <td className="font-mono">{r.value === "unknown" ? <span className="text-faint italic">unreadable</span> : r.value}</td>
            <td className="font-mono text-muted">{r.part_number === "unknown" ? "—" : r.part_number}</td>
            <td><div className="flex flex-wrap gap-1">{r.designators.map((d) => <span key={d} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px]">{d}</span>)}</div></td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}
