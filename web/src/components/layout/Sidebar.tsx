import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark, BookmarkCheck, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search,
  Settings as SettingsIcon, Sun, Trash2, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { Conversation } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Badge, Button, IconButton, Logo, Menu, MenuItem, Modal, ModalHeader } from "../ui/primitives";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onOpenSettings: (tab?: "general" | "profile") => void;
}

function group(convs: Conversation[]) {
  const day = 86400000;
  const start = new Date().setHours(0, 0, 0, 0);
  const g: [string, Conversation[]][] = [["Today", []], ["Previous 7 days", []], ["Older", []]];
  for (const c of convs) g[c.updated >= start ? 0 : c.updated >= start - 7 * day ? 1 : 2][1].push(c);
  return g.filter(([, list]) => list.length);
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose, onOpenSettings }: Props) {
  const { conversations, activeId, select, create, patchConversation, remove, settings, updateSettings } = useStore();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const sorted = useMemo(() => [...conversations].sort((a, b) => b.updated - a.updated), [conversations]);
  const filtered = query ? sorted.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())) : sorted;
  const saved = filtered.filter((c) => c.saved);
  const recent = group(filtered.filter((c) => !c.saved));

  const pick = (id: string) => {
    select(id);
    onMobileClose();
  };
  const initials = (settings.userName || "You").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const item = (c: Conversation) => (
    <div key={c.id} className="group relative">
      {renaming === c.id ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("title")?.toString().trim();
            if (v) patchConversation(c.id, { title: v });
            setRenaming(null);
          }}
        >
          <input
            name="title"
            autoFocus
            defaultValue={c.title}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
            className="h-8 w-full rounded-lg border border-accent bg-surface-2 px-2.5 text-[13px] outline-none"
          />
        </form>
      ) : (
        <button
          onClick={() => pick(c.id)}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg pl-2.5 pr-8 text-left text-[13px] transition-colors",
            c.id === activeId ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <span className="truncate">{c.title}</span>
          {c.mode === "demo" && <Badge tone="info" className="ml-auto shrink-0 !text-[9.5px]">DEMO</Badge>}
        </button>
      )}
      {renaming !== c.id && (
        <div className={cn("absolute right-1 top-1/2 -translate-y-1/2", c.id === activeId ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <Menu
            trigger={(open, toggle) => (
              <IconButton size="sm" label="Conversation options" onClick={toggle} active={open} className="!size-6">
                <MoreHorizontal className="size-4" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={c.saved ? <BookmarkCheck /> : <Bookmark />} onClick={() => { patchConversation(c.id, { saved: !c.saved }); close(); }}>
                  {c.saved ? "Remove from saved" : "Save analysis"}
                </MenuItem>
                <MenuItem icon={<Pencil />} onClick={() => { setRenaming(c.id); close(); }}>Rename</MenuItem>
                <MenuItem icon={<Trash2 />} danger onClick={() => { setDeleting(c); close(); }}>Delete</MenuItem>
              </>
            )}
          </Menu>
        </div>
      )}
    </div>
  );

  const full = (
    <div className="flex h-full w-[272px] flex-col">
      <div className="flex h-14 items-center gap-2.5 px-3.5">
        <Logo size={28} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[14px] font-semibold tracking-tight">Schematic Reader</div>
          <div className="truncate text-[11px] text-faint">AI circuit analysis</div>
        </div>
        <span className="hidden md:block"><IconButton label="Collapse sidebar" onClick={onToggle}><PanelLeftClose className="size-[18px]" /></IconButton></span>
        <span className="md:hidden"><IconButton label="Close sidebar" onClick={onMobileClose}><X className="size-[18px]" /></IconButton></span>
      </div>

      <div className="space-y-2 px-3 pb-2">
        <Button variant="secondary" className="w-full justify-start" icon={<Plus className="size-4" />} onClick={() => { create(); onMobileClose(); }}>
          New analysis
        </Button>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-muted focus-within:border-line-strong">
          <Search className="size-3.5 shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search analyses" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X className="size-3.5" /></button>}
        </label>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {saved.length > 0 && (
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-faint"><BookmarkCheck className="size-3" />Saved analyses</h3>
            <div className="space-y-0.5">{saved.map(item)}</div>
          </section>
        )}
        {recent.map(([label, list]) => (
          <section key={label}>
            <h3 className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">{label}</h3>
            <div className="space-y-0.5">{list.map(item)}</div>
          </section>
        ))}
        {!filtered.length && (
          <div className="px-2.5 py-8 text-center text-[12.5px] leading-relaxed text-faint">
            {query ? "No analyses match your search." : (<><MessageSquare className="mx-auto mb-2 size-5" />Your analyses will appear here. Start by dropping a schematic into the workspace.</>)}
          </div>
        )}
      </nav>

      <div className="space-y-1 border-t border-line p-3">
        <div className="flex gap-1">
          <Button variant="ghost" className="flex-1 justify-start" icon={<SettingsIcon className="size-4" />} onClick={() => onOpenSettings("general")}>Settings</Button>
          <IconButton label={settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}>
            {settings.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
        </div>
        <button onClick={() => onOpenSettings("profile")} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-[12px] font-semibold text-accent-fg">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{settings.userName || "Set your name"}</span>
            <span className="block truncate text-[11px] text-faint">{settings.mode === "demo" ? "Demo mode" : "Local workspace"}</span>
          </span>
        </button>
      </div>
    </div>
  );

  const rail = (
    <div className="flex h-full w-[60px] flex-col items-center gap-1 py-3">
      <button onClick={onToggle} className="mb-2 rounded-lg p-0.5" aria-label="Expand sidebar" title="Expand sidebar"><Logo size={30} /></button>
      <IconButton label="Expand sidebar" onClick={onToggle}><PanelLeftOpen className="size-[18px]" /></IconButton>
      <IconButton label="New analysis" onClick={() => create()}><Plus className="size-[18px]" /></IconButton>
      <div className="flex-1" />
      <IconButton label="Settings" onClick={() => onOpenSettings("general")}><SettingsIcon className="size-[18px]" /></IconButton>
      <IconButton label="Toggle theme" onClick={() => updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}>
        {settings.theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </IconButton>
      <button onClick={() => onOpenSettings("profile")} title="Profile" className="mt-1 flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-[12px] font-semibold text-accent-fg">{initials}</button>
    </div>
  );

  return (
    <>
      <motion.aside
        className="relative hidden h-full shrink-0 overflow-hidden border-r border-line bg-surface md:block"
        animate={{ width: collapsed ? 60 : 272 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        {collapsed ? rail : full}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onMobileClose} />
            <motion.aside
              className="absolute inset-y-0 left-0 border-r border-line bg-surface shadow-pop"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              {full}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} label="Delete analysis" className="max-w-sm">
        <ModalHeader title="Delete this analysis?" onClose={() => setDeleting(null)} />
        <div className="px-5 py-4 text-[13.5px] leading-relaxed text-muted">
          <span className="font-medium text-fg">{deleting?.title}</span> and its messages will be removed from this browser. Files already generated on the analysis server are kept.
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => { if (deleting) remove(deleting.id); setDeleting(null); }}>Delete</Button>
        </div>
      </Modal>
    </>
  );
}
