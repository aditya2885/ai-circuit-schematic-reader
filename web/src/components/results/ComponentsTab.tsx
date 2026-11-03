import { Pencil, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { CATEGORIES, type Component } from "../../lib/types";
import { cn, labelOf } from "../../lib/utils";
import { Badge, Button, EmptyState, IconButton } from "../ui/primitives";
import { EvidenceBadge, inputCls, Panel, Table, type TabProps } from "./shared";

const strip = (cs: Component[]) => cs.map(({ evidence: _e, ...c }) => ({ ...c, pins: c.pins.map((p) => ({ ...p })) }));

export function ComponentsTab({ service, analysis, result, tall, onAnalysis }: TabProps) {
  const { toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Component[]>(() => strip(result.components));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(strip(result.components));
  }, [result.components, editing]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    result.components.forEach((c) => m.set(c.category, (m.get(c.category) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [result.components]);
  const levels = {
    traced: result.components.filter((c) => c.evidence?.level === "traced").length,
    check: result.components.filter((c) => c.evidence?.level === "check").length,
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(strip(result.components));
  const set = (i: number, patch: Partial<Component>) => setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setNet = (i: number, p: number, net: string) =>
    setDraft((d) => d.map((c, j) => (j === i ? { ...c, pins: c.pins.map((x, k) => (k === p ? { ...x, net } : x)) } : c)));

  const save = async () => {
    const names = draft.map((c) => c.designator.trim());
    if (names.some((n) => !n)) return setError("Every part needs a designator.");
    if (new Set(names).size !== names.length) return setError("Two parts have the same designator.");
    setSaving(true);
    setError(null);
    try {
      onAnalysis(await service.updateComponents(analysis.id, draft.map((c) => ({ ...c, designator: c.designator.trim(), value: c.value.trim() || "unknown" }))));
      setEditing(false);
      toast("Components saved; netlist and BOM rebuilt", "ok");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!result.components.length)
    return <EmptyState icon={<Pencil />} title="No components were read">The model did not list any parts. Check the image is a circuit schematic, or add parts by hand with Edit.</EmptyState>;

  const rows = editing ? draft : result.components;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {counts.map(([cat, n]) => (
          <Badge key={cat}>{labelOf(cat)} <span className="tabular text-fg">{n}</span></Badge>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <Badge tone="ok" title="Connections confirmed by tracing the wires in the image">{levels.traced} traced</Badge>
        {levels.check > 0 && <Badge tone="warn" title="Parts the reader flagged: check them on the drawing">{levels.check} to check</Badge>}
        {result.edited && <Badge tone="info">edited</Badge>}
      </div>

      <Panel
        title="Components"
        actions={
          editing ? (
            <>
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}
                onClick={() => setDraft((d) => [...d, { designator: `X${d.length + 1}`, category: "resistor", value: "unknown", part_number: "unknown", role: "", pins: [{ pin: "1", net: "unknown" }, { pin: "2", net: "unknown" }] }])}>
                Add part
              </Button>
              <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} loading={saving} disabled={!dirty} onClick={save}>Save changes</Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit</Button>
          )
        }
      >
        {error && <div className="border-b border-line bg-err-soft px-3.5 py-2 text-[12.5px] text-err">{error}</div>}
        <Table
          className={tall ? "max-h-[60vh]" : "max-h-[420px]"}
          head={
            <>
              <th className="w-10">#</th>
              <th>ID</th>
              <th>Type</th>
              <th>Value / rating</th>
              <th>Role</th>
              <th>Pins → nets</th>
              <th title="Traced: connections confirmed from the wires in the image. Model: the vision model's reading only. Check: the reader flagged this part.">Confidence</th>
              {editing && <th />}
            </>
          }
        >
          {rows.map((c, i) => (
            <tr key={i} className={cn("transition-colors", !editing && "hover:bg-surface-2/60")}>
              <td className="font-mono text-[12px] tabular text-faint">{String(i + 1).padStart(2, "0")}</td>
              <td className="min-w-20">
                {editing ? <input aria-label="Designator" className={cn(inputCls, "font-mono")} value={c.designator} onChange={(e) => set(i, { designator: e.target.value })} />
                  : <span className="font-mono text-[13px] font-semibold">{c.designator}</span>}
              </td>
              <td className="min-w-32">
                {editing ? (
                  <select aria-label="Type" className={inputCls} value={c.category} onChange={(e) => set(i, { category: e.target.value as Component["category"] })}>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{labelOf(cat)}</option>)}
                  </select>
                ) : labelOf(c.category)}
              </td>
              <td className="min-w-28">
                {editing ? <input aria-label="Value" className={cn(inputCls, "font-mono")} value={c.value} onChange={(e) => set(i, { value: e.target.value })} />
                  : c.value === "unknown" ? <span className="text-faint italic">unreadable</span> : <span className="font-mono">{c.value}</span>}
              </td>
              <td className="min-w-28 text-muted">
                {editing ? <input aria-label="Role" className={inputCls} value={c.role} onChange={(e) => set(i, { role: e.target.value })} /> : c.role || "—"}
              </td>
              <td className="min-w-44">
                <div className="flex flex-wrap gap-1">
                  {c.pins.map((p, k) =>
                    editing ? (
                      <label key={k} className="flex items-center gap-1 font-mono text-[11.5px] text-faint">
                        {p.pin}
                        <input aria-label={`Net of pin ${p.pin}`} className={cn(inputCls, "h-6 w-20 font-mono text-[12px]")} value={p.net} onChange={(e) => setNet(i, k, e.target.value)} />
                      </label>
                    ) : (
                      <span key={k} className={cn("rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px]", p.net === "unknown" && "border-[color-mix(in_oklab,var(--warn),transparent_60%)] text-warn")}>
                        <span className="text-faint">{p.pin}</span>→{p.net}
                      </span>
                    ),
                  )}
                  {!c.pins.length && <span className="text-[12px] text-faint">no pins read</span>}
                </div>
              </td>
              <td>
                <EvidenceBadge evidence={result.components.find((x) => x.designator === c.designator)?.evidence} />
              </td>
              {editing && (
                <td>
                  <IconButton size="sm" label={`Delete ${c.designator}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton>
                </td>
              )}
            </tr>
          ))}
        </Table>
      </Panel>
      <p className="text-[12px] leading-relaxed text-faint">
        <b className="font-medium text-muted">Confidence</b> is the evidence behind each part, not a model score: <span className="text-ok">Traced</span> means its connections were confirmed by tracing the wires in the image; <span className="text-muted">Model</span> is the vision model's reading alone; <span className="text-warn">Check</span> means the reader flagged it (hover for why). Saving edits rebuilds the netlist, connections and BOM{analysis.simulink.status !== "idle" ? " and marks the Simulink model out of date" : ""}.
      </p>
    </div>
  );
}
