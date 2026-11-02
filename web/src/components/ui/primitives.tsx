import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn, copyText } from "../../lib/utils";

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong shadow-[0_0_0_1px_var(--accent),0_8px_24px_-10px_var(--accent)]",
  secondary: "bg-surface-3 text-fg hover:bg-[color-mix(in_oklab,var(--surface-3),var(--fg)_6%)] border border-line",
  outline: "border border-line-strong text-fg hover:bg-surface-2",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-err-soft text-err hover:bg-[color-mix(in_oklab,var(--err-soft),var(--err)_14%)] border border-[color-mix(in_oklab,var(--err),transparent_75%)]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 select-none whitespace-nowrap",
        "disabled:opacity-50 active:scale-[0.98]",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-40",
        size === "md" ? "size-9" : "size-7",
        active ? "bg-surface-3 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      icon={done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------- badges and status

export type Tone = "neutral" | "accent" | "ok" | "warn" | "err" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  accent: "bg-accent-soft text-accent border-[color-mix(in_oklab,var(--accent),transparent_75%)]",
  ok: "bg-ok-soft text-ok border-[color-mix(in_oklab,var(--ok),transparent_78%)]",
  warn: "bg-warn-soft text-warn border-[color-mix(in_oklab,var(--warn),transparent_75%)]",
  err: "bg-err-soft text-err border-[color-mix(in_oklab,var(--err),transparent_75%)]",
  info: "bg-info-soft text-info border-[color-mix(in_oklab,var(--info),transparent_75%)]",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const color = { neutral: "bg-faint", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", err: "bg-err", info: "bg-info" }[tone];
  return (
    <span className="relative inline-flex size-2">
      {pulse && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

// ---------------------------------------------------------------- modal

export function Modal({
  open, onClose, children, className, label,
}: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={cn("relative w-full rounded-2xl border border-line-strong bg-surface shadow-pop", className)}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ModalHeader({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
      <IconButton label="Close" onClick={onClose} size="sm">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------- tabs

export function Tabs<T extends string>({
  tabs, value, onChange, className,
}: { tabs: { id: T; label: string; icon?: ReactNode; count?: number | string; tone?: Tone }[]; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto no-scrollbar", className)}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              on ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {on && <motion.span layoutId={`tab-${tabs.map((x) => x.id).join("")}`} className="absolute inset-0 rounded-lg border border-line bg-surface-3" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">
              {t.icon}
              {t.label}
              {t.count !== undefined && (
                <span className={cn("rounded px-1 text-[10.5px] tabular", t.tone && t.tone !== "neutral" ? tones[t.tone] : "bg-surface-2 text-faint")}>{t.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- popover menu

export function Menu({ trigger, children, align = "right" }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className={cn("absolute z-40 mt-1 min-w-44 rounded-xl border border-line-strong bg-surface p-1 shadow-pop", align === "right" ? "right-0" : "left-0")}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors", danger ? "text-err hover:bg-err-soft" : "text-fg hover:bg-surface-2")}
    >
      <span className="text-muted [&>svg]:size-4">{icon}</span>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- misc

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="lg-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity=".9" />
          <stop offset="1" stopColor="var(--info)" stopOpacity=".5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="var(--surface-2)" stroke="url(#lg-b)" strokeWidth="1.2" />
      <path d="M5 16h5l2-5 3 10 3-10 3 10 2-5h4" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5" cy="16" r="1.6" fill="var(--accent)" />
      <circle cx="27" cy="16" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted [&>svg]:size-5">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}
