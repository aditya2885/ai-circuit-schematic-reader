import { Download, FlaskConical, Monitor, Moon, Radio, Sun, Trash2, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useStore } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { cn, downloadText } from "../../lib/utils";
import { Button, Modal, ModalHeader, Tabs } from "../ui/primitives";

export type SettingsTab = "general" | "analysis" | "profile";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[12px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}

const input = "h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13.5px] outline-none transition-colors focus:border-accent";

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon: ReactNode; text: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", value === o.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
          <span className={cn("mt-0.5", value === o.id ? "text-accent" : "text-muted")}>{o.icon}</span>
          <span><span className="block text-[13.5px] font-medium">{o.label}</span><span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{o.text}</span></span>
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({ open, tab, onTab, onClose }: { open: boolean; tab: SettingsTab; onTab: (t: SettingsTab) => void; onClose: () => void }) {
  const { settings, updateSettings, backend, conversations, remove, toast } = useStore();
  const [confirmClear, setConfirmClear] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>);
  const models = backend.status === "online" ? backend.health.ollama.models : [];

  return (
    <Modal open={open} onClose={onClose} label="Settings" className="flex max-h-[90vh] max-w-xl flex-col">
      <ModalHeader title="Settings" onClose={onClose} />
      <div className="border-b border-line px-4 py-2">
        <Tabs value={tab} onChange={onTab} tabs={[
          { id: "general" as const, label: "General" },
          { id: "analysis" as const, label: "Analysis" },
          { id: "profile" as const, label: "Profile & data" },
        ]} />
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {tab === "general" && (
          <>
            <Field label="Mode" hint="Demo mode is clearly labelled everywhere and never presents saved samples as an analysis of your files.">
              <Choice value={settings.mode} onChange={(v) => set("mode", v)} options={[
                { id: "live", label: "Live", icon: <Radio className="size-4" />, text: "Your images go to the Python server, Qwen3-VL and MATLAB." },
                { id: "demo", label: "Demo", icon: <FlaskConical className="size-4" />, text: "Replays analyses saved from real runs. No server needed." },
              ]} />
            </Field>
            <Field label="Theme">
              <Choice value={settings.theme} onChange={(v) => set("theme", v)} options={[
                { id: "dark", label: "Dark", icon: <Moon className="size-4" />, text: "Deep charcoal, easy on the eyes." },
                { id: "light", label: "Light", icon: <Sun className="size-4" />, text: "Bright, for printed-page contrast." },
              ]} />
            </Field>
            <Field label="Analysis server URL" hint={<>Leave empty to use this site's own address (the dev server proxies <code className="font-mono">/api</code>). Default from <code className="font-mono">VITE_API_URL</code>.</>}>
              <input className={input} value={settings.apiUrl} placeholder="same origin" onChange={(e) => set("apiUrl", e.target.value.trim())} />
            </Field>
          </>
        )}

        {tab === "analysis" && (
          <>
            <Field label="Vision model" hint="Reads the schematic and answers your questions. Must be pulled in Ollama.">
              <input className={input} list="sr-models" value={settings.model} onChange={(e) => set("model", e.target.value.trim())} />
            </Field>
            <Field label="Box model (optional)" hint="A separate model asked only for part boxes during wire tracing, e.g. the fine-tuned qwen3-vl-circuits. Empty uses the vision model.">
              <input className={input} list="sr-models" value={settings.boxModel} placeholder="same as vision model" onChange={(e) => set("boxModel", e.target.value.trim())} />
            </Field>
            <datalist id="sr-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <Field label={`Image size for the model: ${settings.maxSide}px`} hint="Longest side the schematic is scaled to. 1600 is the reader's default; the box fine-tune was trained at 1000.">
              <input type="range" min={800} max={2400} step={100} value={settings.maxSide} onChange={(e) => set("maxSide", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
              <input type="checkbox" checked={settings.autoSimulink} onChange={(e) => set("autoSimulink", e.target.checked)} className="mt-1 accent-[var(--accent)]" />
              <span><span className="block text-[13.5px] font-medium">Generate the Simulink model automatically</span><span className="mt-0.5 block text-[12px] text-muted">Runs MATLAB right after the analysis. Off: generate it from the MATLAB/Simulink tab once the circuit looks right.</span></span>
            </label>
          </>
        )}

        {tab === "profile" && (
          <>
            <Field label="Your name" hint="Used for the greeting. Stored only in this browser.">
              <div className="flex items-center gap-2">
                <User className="size-4 text-muted" />
                <input className={input} value={settings.userName} placeholder="e.g. Alex" onChange={(e) => set("userName", e.target.value)} />
              </div>
            </Field>
            <div className="space-y-2">
              <div className="text-[13px] font-medium">Conversation history</div>
              <p className="text-[12px] text-faint">{conversations.length} conversation{conversations.length === 1 ? "" : "s"} saved in this browser. Analysis files stay on the server in <code className="font-mono">server_data/</code>.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} disabled={!conversations.length}
                  onClick={() => downloadText(JSON.stringify(conversations, null, 2), "schematic-reader-conversations.json", "application/json")}>Export history</Button>
                {confirmClear ? (
                  <>
                    <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => { conversations.forEach((c) => remove(c.id)); setConfirmClear(false); toast("History cleared", "ok"); }}>Delete all</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={!conversations.length} onClick={() => setConfirmClear(true)}>Clear history…</Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-line p-3 text-[12px] text-muted"><Monitor className="size-4" />Everything runs locally: the model on your GPU via Ollama, the model build in your MATLAB.</div>
          </>
        )}
      </div>
    </Modal>
  );
}
