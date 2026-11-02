import { Maximize, Minus, Plus, Scan } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { IconButton } from "./primitives";

export interface Overlay {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: "accent" | "warn" | "err" | "muted";
}

interface Props {
  src: string;
  alt: string;
  overlays?: Overlay[];
  /** Coordinate space the overlays are given in (e.g. the reader's prepared image size). */
  frame?: [number, number];
  highlight?: string | null;
  onHover?: (id: string | null) => void;
  className?: string;
  toolbar?: ReactNode;
}

const MIN = 0.05;
const MAX = 12;

/** Zoom (wheel, buttons, double-click) and pan (drag) for a schematic, with optional part boxes on top. */
export function ImageViewer({ src, alt, overlays = [], frame, highlight, onHover, className, toolbar }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<[number, number] | null>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !nat) return;
    const s = Math.min((el.clientWidth - 32) / nat[0], (el.clientHeight - 32) / nat[1], 4);
    setFitScale(s);
    setView({ s, x: (el.clientWidth - nat[0] * s) / 2, y: (el.clientHeight - nat[1] * s) / 2 });
  }, [nat]);

  useEffect(() => {
    setNat(null);
    setFailed(false);
  }, [src]);
  useEffect(fit, [fit]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const s = Math.min(MAX, Math.max(MIN, v.s * factor));
      const k = s / v.s;
      return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onUp = () => (drag.current = null);

  const kx = nat && frame ? nat[0] / frame[0] : 1;
  const ky = nat && frame ? nat[1] / frame[1] : 1;
  const pct = Math.round((view.s / (fitScale || 1)) * 100);

  return (
    <div
      ref={box}
      className={cn("checker relative touch-none overflow-hidden rounded-xl border border-line select-none", drag.current ? "cursor-grabbing" : "cursor-grab", className)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        const r = box.current!.getBoundingClientRect();
        zoomAt(2, e.clientX - r.left, e.clientY - r.top);
      }}
    >
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">The image could not be loaded.</div>
      ) : (
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, width: nat?.[0], height: nat?.[1] }}>
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
            onError={() => setFailed(true)}
            className={cn("block max-w-none bg-white shadow-card", !nat && "invisible")}
          />
          {nat &&
            overlays.map((o) => {
              const on = highlight === o.id;
              return (
                <div
                  key={o.id}
                  onPointerEnter={() => onHover?.(o.id)}
                  onPointerLeave={() => onHover?.(null)}
                  className={cn(
                    "absolute rounded-[3px] border transition-all duration-150",
                    o.tone === "warn" ? "border-warn" : o.tone === "err" ? "border-err" : o.tone === "muted" ? "border-faint" : "border-accent",
                    on ? "bg-accent/15 shadow-[0_0_0_3px_var(--accent-soft)]" : "bg-transparent",
                  )}
                  style={{ left: o.x * kx, top: o.y * ky, width: o.w * kx, height: o.h * ky, borderWidth: 2 / view.s }}
                >
                  <span
                    className={cn("absolute left-0 whitespace-nowrap rounded-[3px] px-1 font-mono font-semibold text-accent-fg", o.tone === "warn" ? "bg-warn" : o.tone === "err" ? "bg-err" : o.tone === "muted" ? "bg-faint" : "bg-accent")}
                    style={{ fontSize: 11 / view.s, bottom: "100%", marginBottom: 2 / view.s, padding: `${1 / view.s}px ${4 / view.s}px`, borderRadius: 3 / view.s }}
                  >
                    {o.label}
                  </span>
                </div>
              );
            })}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-1 shadow-card backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        {toolbar}
        <IconButton size="sm" label="Zoom out" onClick={() => zoomAt(1 / 1.3)}><Minus className="size-4" /></IconButton>
        <button onClick={fit} title="Fit to view" className="min-w-11 rounded-md px-1 text-[11.5px] font-medium tabular text-muted hover:text-fg">{pct}%</button>
        <IconButton size="sm" label="Zoom in" onClick={() => zoomAt(1.3)}><Plus className="size-4" /></IconButton>
        <IconButton size="sm" label="Fit to view" onClick={fit}><Scan className="size-4" /></IconButton>
        {nat && (
          <IconButton size="sm" label="Actual size" onClick={() => {
            const el = box.current!;
            setView({ s: 1, x: (el.clientWidth - nat[0]) / 2, y: (el.clientHeight - nat[1]) / 2 });
          }}>
            <Maximize className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
