import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, FileUp, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatView } from "./components/chat/ChatView";
import { offerFile } from "./components/chat/Composer";
import { SettingsDialog, type SettingsTab } from "./components/layout/SettingsDialog";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { StoreProvider, useStore } from "./lib/store";
import { readStorage, writeStorage } from "./lib/utils";

function Toaster() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[13px] shadow-pop">
            {t.tone === "ok" ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : t.tone === "err" ? <CircleAlert className="size-4 shrink-0 text-err" /> : <Info className="size-4 shrink-0 text-info" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-faint hover:text-fg"><X className="size-3.5" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Page-wide drag and drop: a file dropped anywhere goes to the composer. */
function DropZone() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth.current++; setOver(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth.current <= 0) { depth.current = 0; setOver(false); } };
    const dragover = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const f = e.dataTransfer?.files[0];
      if (f) offerFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return (
    <AnimatePresence>
      {over && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-bg/75 p-6 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="flex w-full max-w-lg flex-col items-center rounded-3xl border-2 border-dashed border-accent bg-surface/80 px-8 py-14 text-center shadow-pop">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><FileUp className="size-7" /></div>
            <div className="text-[17px] font-semibold">Drop your schematic</div>
            <div className="mt-1 text-[13px] text-muted">JPG, PNG or PDF, up to 25 MB</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => readStorage("sr.sidebar.collapsed", false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState<{ open: boolean; tab: SettingsTab }>({ open: false, tab: "general" });
  const { create } = useStore();

  useEffect(() => writeStorage("sr.sidebar.collapsed", collapsed), [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); create(); }
      if (mod && e.key === "b") { e.preventDefault(); setCollapsed((c: boolean) => !c); }
      if (mod && e.key === ",") { e.preventDefault(); setSettings({ open: true, tab: "general" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [create]);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c: boolean) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onOpenSettings={(tab = "general") => setSettings({ open: true, tab })}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <ChatView />
      </main>
      <SettingsDialog open={settings.open} tab={settings.tab} onTab={(tab) => setSettings({ open: true, tab })} onClose={() => setSettings((s) => ({ ...s, open: false }))} />
      <DropZone />
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
