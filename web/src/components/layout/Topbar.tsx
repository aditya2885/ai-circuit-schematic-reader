import { Bookmark, BookmarkCheck, Cpu, FlaskConical, Menu as MenuIcon, Plus, RefreshCw, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "../../lib/store";
import { cn } from "../../lib/utils";
import { Badge, Button, Dot, IconButton, Menu, type Tone } from "../ui/primitives";

export function BackendStatus() {
  const { settings, backend, recheckBackend, updateSettings } = useStore();
  let tone: Tone = "neutral";
  let label = "Checking…";
  if (settings.mode === "demo") {
    tone = "info";
    label = "Demo mode";
  } else if (backend.status === "offline") {
    tone = "err";
    label = "Server offline";
  } else if (backend.status === "online") {
    const h = backend.health;
    const hasModel = h.ollama.models.some((m) => m === settings.model || m === `${settings.model}:latest`);
    tone = !h.ollama.ok ? "warn" : hasModel ? "ok" : "warn";
    label = !h.ollama.ok ? "Ollama offline" : hasModel ? "Live" : "Model missing";
  }

  return (
    <Menu
      trigger={(open, toggle) => (
        <button
          onClick={toggle}
          className={cn("flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors", open ? "border-line-strong bg-surface-2" : "border-line hover:bg-surface-2")}
        >
          <Dot tone={tone} pulse={tone === "ok" || backend.status === "checking"} />
          <span className="text-muted">{label}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="w-72 p-2">
          {settings.mode === "demo" ? (
            <div className="space-y-2 p-1.5 text-[12.5px] leading-relaxed text-muted">
              <div className="flex items-center gap-2 font-medium text-fg"><FlaskConical className="size-4 text-info" />Demo mode</div>
              <p>Replays two analyses saved from real runs of the pipeline. Your own images are not analysed and no model runs.</p>
              <Button size="sm" variant="secondary" className="w-full" onClick={() => { updateSettings({ mode: "live" }); close(); }}>Switch to live mode</Button>
            </div>
          ) : (
            <div className="space-y-2.5 p-1.5 text-[12.5px]">
              <Row icon={<Server className="size-3.5" />} name="Analysis server" ok={backend.status === "online"} text={backend.status === "online" ? `v${backend.health.version}` : backend.status === "offline" ? "not reachable" : "checking"} />
              <Row icon={<Cpu className="size-3.5" />} name="Ollama" ok={backend.status === "online" && backend.health.ollama.ok}
                text={backend.status === "online" ? (backend.health.ollama.ok ? `${backend.health.ollama.models.length} models` : "not running") : "—"} />
              <Row icon={<Cpu className="size-3.5" />} name={settings.model} ok={backend.status === "online" && backend.health.ollama.models.some((m) => m === settings.model || m === `${settings.model}:latest`)} text="" />
              <Row icon={<Cpu className="size-3.5" />} name="MATLAB" ok={backend.status === "online" && backend.health.matlab.ok} text={backend.status === "online" ? (backend.health.matlab.ok ? "found" : "not found") : "—"} />
              {backend.status === "offline" && (
                <p className="rounded-lg bg-surface-2 p-2 leading-relaxed text-muted">
                  Start it from the project folder:<br /><code className="font-mono text-[11.5px] text-fg">python server/app.py</code>
                </p>
              )}
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" variant="secondary" className="flex-1" icon={<RefreshCw className="size-3.5" />} onClick={recheckBackend}>Recheck</Button>
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => { updateSettings({ mode: "demo" }); close(); }}>Use demo</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}

function Row({ icon, name, ok, text }: { icon: ReactNode; name: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-faint">{text}</span>
      <Dot tone={ok ? "ok" : "err"} />
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { active, patchConversation, create } = useStore();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur md:px-4">
      <IconButton label="Open sidebar" onClick={onMenu} className="md:hidden"><MenuIcon className="size-5" /></IconButton>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-[14px] font-medium">{active ? active.title : "New analysis"}</h1>
        {active?.mode === "demo" && <Badge tone="info">DEMO</Badge>}
      </div>
      <BackendStatus />
      {active && (
        <IconButton label={active.saved ? "Remove from saved" : "Save analysis"} onClick={() => patchConversation(active.id, { saved: !active.saved })}>
          {active.saved ? <BookmarkCheck className="size-[18px] text-accent" /> : <Bookmark className="size-[18px]" />}
        </IconButton>
      )}
      <IconButton label="New analysis" onClick={() => create()} className="md:hidden"><Plus className="size-5" /></IconButton>
    </header>
  );
}
