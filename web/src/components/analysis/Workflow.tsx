import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronDown, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Stage, StepStatus } from "../../lib/types";
import { cn, duration } from "../../lib/utils";

export function StepIcon({ status, index }: { status: StepStatus; index: number }) {
  const base = "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors";
  switch (status) {
    case "done":
      return <span className={cn(base, "bg-ok-soft text-ok ring-1 ring-[color-mix(in_oklab,var(--ok),transparent_65%)]")}><Check className="size-3.5" strokeWidth={2.75} /></span>;
    case "warning":
      return <span className={cn(base, "bg-warn-soft text-warn ring-1 ring-[color-mix(in_oklab,var(--warn),transparent_60%)]")}><AlertTriangle className="size-3" strokeWidth={2.5} /></span>;
    case "error":
      return <span className={cn(base, "bg-err-soft text-err ring-1 ring-[color-mix(in_oklab,var(--err),transparent_55%)]")}><X className="size-3.5" strokeWidth={2.75} /></span>;
    case "skipped":
      return <span className={cn(base, "bg-surface-3 text-faint ring-1 ring-line")}><Minus className="size-3.5" /></span>;
    case "running":
      return (
        <span className={cn(base, "bg-accent-soft text-accent")}>
          <svg className="absolute inset-0 size-6 animate-spin" viewBox="0 0 24 24" style={{ animationDuration: "0.9s" }}>
            <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
            <path d="M12 1.5a10.5 10.5 0 0 1 10.5 10.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {index + 1}
        </span>
      );
    default:
      return <span className={cn(base, "bg-surface-2 text-faint ring-1 ring-line")}>{index + 1}</span>;
  }
}

const statusText: Record<StepStatus, string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  warning: "Done, with warnings",
  error: "Failed",
  skipped: "Not run",
};

export function Workflow({ stages, compact }: { stages: Stage[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [, tick] = useState(0);
  const running = stages.some((s) => s.status === "running");

  // Re-render each second while something runs, so elapsed times count up.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const finished = stages.filter((s) => ["done", "warning", "skipped", "error"].includes(s.status)).length;
  const pct = (finished + (running ? 0.5 : 0)) / stages.length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="h-[3px] bg-surface-2">
        <motion.div className="h-full bg-gradient-to-r from-accent to-info" initial={false} animate={{ width: `${pct * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} />
      </div>
      <ol className={cn("relative", compact ? "p-2" : "p-2.5")}>
        {stages.map((s, i) => {
          const isOpen = open === s.key;
          const hasMore = s.description || s.log.length > 0;
          const time = s.started ? duration(s.started, s.ended) : "";
          return (
            <li key={s.key} className="relative">
              {i < stages.length - 1 && (
                <span className={cn("absolute left-[21px] top-8 bottom-[-6px] w-px", ["done", "warning", "skipped"].includes(s.status) ? "bg-[color-mix(in_oklab,var(--ok),transparent_60%)]" : "bg-line")} />
              )}
              <button
                onClick={() => hasMore && setOpen(isOpen ? null : s.key)}
                className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors", hasMore && "hover:bg-surface-2", s.status === "running" && "bg-accent-soft/50")}
                aria-expanded={isOpen}
              >
                <StepIcon status={s.status} index={i} />
                <span className="min-w-0 flex-1 pt-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("text-[13.5px] font-medium", s.status === "pending" ? "text-muted" : "text-fg", s.status === "running" && "shimmer")}>{s.title}</span>
                    <span className={cn("text-[11.5px]", s.status === "error" ? "text-err" : s.status === "warning" ? "text-warn" : "text-faint")}>{statusText[s.status]}</span>
                    {time && <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-faint">{time}</span>}
                  </span>
                  {s.detail && <span className="mt-0.5 block truncate text-[12.5px] text-muted" title={s.detail}>{s.detail}</span>}
                </span>
                {hasMore && <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition-transform", isOpen && "rotate-180")} />}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="ml-[46px] mr-2.5 mb-2 space-y-2 text-[12.5px]">
                      <p className="leading-relaxed text-muted">{s.description}</p>
                      {s.log.length > 0 && (
                        <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">
                          {s.log.join("\n")}
                        </pre>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
