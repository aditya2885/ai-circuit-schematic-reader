import { Download } from "lucide-react";
import type { ReactNode } from "react";
import type { CircuitService } from "../../lib/service";
import type { Analysis, CircuitResult, Evidence } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/primitives";

export interface TabProps {
  service: CircuitService;
  analysis: Analysis;
  result: CircuitResult;
  tall?: boolean;
  onAnalysis: (a: Analysis) => void;
}

export function EvidenceBadge({ evidence }: { evidence?: Evidence | null }) {
  if (!evidence) return <Badge>—</Badge>;
  const tip = [...evidence.reasons, ...evidence.corrections.map((c) => `corrected: ${c}`)].join("\n");
  if (evidence.level === "traced") return <Badge tone="ok" title={tip}>● Traced</Badge>;
  if (evidence.level === "check") return <Badge tone="warn" title={tip}>▲ Check</Badge>;
  return <Badge title={tip}>○ Model</Badge>;
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
          <h4 className="mr-auto text-[13px] font-medium">{title}</h4>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function DownloadLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      download
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-3", className)}
    >
      <Download className="size-3.5 text-muted" />
      {children}
    </a>
  );
}

/** Table shell with sticky header and horizontal scroll on narrow screens. */
export function Table({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-auto", className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
          <tr className="text-left text-[11.5px] font-medium uppercase tracking-wide text-faint [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:whitespace-nowrap">{head}</tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr>td]:px-3 [&>tr>td]:py-2 [&>tr>td]:align-middle">{children}</tbody>
      </table>
    </div>
  );
}

export const inputCls = "h-7 w-full min-w-0 rounded-md border border-line bg-surface-2 px-2 text-[13px] outline-none transition-colors focus:border-accent focus:bg-surface";
