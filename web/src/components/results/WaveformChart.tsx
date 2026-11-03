import { useEffect, useMemo, useRef, useState } from "react";
import type { Waveforms } from "../../lib/types";
import { cn } from "../../lib/utils";

// The Simulink scope, in the page: MATLAB's simulated node voltages over time. One shared volt axis
// (all series are voltages), fixed-order series colours, a crosshair tooltip, and a legend that toggles series.

const MAX_SERIES = 8; // the validated categorical palette has eight slots; further nets stay in the table
const H = 260;
const PAD = { l: 52, r: 16, t: 14, b: 30 };

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [];
  if (lo === hi) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function timeUnit(span: number): [number, string] {
  if (span >= 1) return [1, "s"];
  if (span >= 1e-3) return [1e3, "ms"];
  return [1e6, "µs"];
}

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
};

export function WaveformChart({ data }: { data: Waveforms }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const series = useMemo(() => data.series.slice(0, MAX_SERIES).map((s, i) => ({ ...s, color: `var(--series-${i + 1})` })), [data]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = series.filter((s) => !hidden.has(s.name));
  const t = data.t;
  const t0 = t[0] ?? 0;
  const t1 = t[t.length - 1] ?? 1;
  const [tk, tu] = timeUnit(t1 - t0);
  let lo = Math.min(...shown.flatMap((s) => s.y));
  let hi = Math.max(...shown.flatMap((s) => s.y));
  if (!shown.length || !isFinite(lo)) [lo, hi] = [0, 1];
  if (lo > 0 && lo < hi * 0.25) lo = 0; // keep the zero line when the data sits near it
  if (hi < 0 && hi > lo * 0.25) hi = 0;
  const span = hi - lo || Math.abs(hi) || 1;
  lo -= span * 0.08;
  hi += span * 0.08;

  const iw = width - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (v: number) => PAD.l + ((v - t0) / (t1 - t0 || 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
  const path = (ys: number[]) => ys.map((v, i) => `${i ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tv = t0 + ((e.clientX - r.left - PAD.l) / iw) * (t1 - t0);
    let lo2 = 0;
    let hi2 = t.length - 1;
    while (hi2 - lo2 > 1) {
      const mid = (lo2 + hi2) >> 1;
      if (t[mid] < tv) lo2 = mid;
      else hi2 = mid;
    }
    setHover(Math.abs(t[lo2] - tv) <= Math.abs(t[hi2] - tv) ? lo2 : hi2);
  };

  const toggle = (name: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(name)) n.delete(name);
      else if (shown.length > 1) n.add(name); // always keep one series on
      return n;
    });

  const hx = hover !== null ? x(t[hover]) : 0;
  const tipLeft = hover !== null && hx > width - 190;

  return (
    <div className="space-y-2">
      {/* legend: always present for two or more series; toggles a series on and off */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Series">
          {series.map((s) => {
            const on = !hidden.has(s.name);
            return (
              <button
                key={s.name}
                aria-pressed={on}
                onClick={() => toggle(s.name)}
                className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px] transition-opacity", on ? "border-line bg-surface-2 text-fg" : "border-transparent text-faint opacity-60")}
              >
                <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
                V({s.name})
              </button>
            );
          })}
          {data.series.length > MAX_SERIES && <span className="self-center text-[11.5px] text-faint">+{data.series.length - MAX_SERIES} more nets in the table</span>}
        </div>
      )}

      <div ref={box} className="relative">
        <svg width={width} height={H} className="block touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Simulated node voltages from ${fmt(t0 * tk)} to ${fmt(t1 * tk)} ${tu}`}>
          {niceTicks(lo, hi).map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : "2 4"} />
              <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] font-mono text-[10.5px]">{fmt(v)}</text>
            </g>
          ))}
          {niceTicks(t0 * tk, t1 * tk, Math.max(2, Math.floor(iw / 90))).map((v) => (
            <text key={`x${v}`} x={x(v / tk)} y={H - 10} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10.5px]">{fmt(v)}</text>
          ))}
          <text x={PAD.l - 8} y={H - 10} textAnchor="end" className="fill-[var(--faint)] text-[10.5px]">{tu}</text>
          <text x={12} y={PAD.t + 4} className="fill-[var(--faint)] text-[10.5px]">V</text>

          {shown.map((s) => (
            <path key={s.name} d={path(s.y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* direct labels at the line ends when few series are shown */}
          {shown.length <= 4 &&
            shown
              .map((s) => ({ name: s.name, at: y(s.y[s.y.length - 1]) - 6 }))
              .sort((a, b) => a.at - b.at)
              .reduce<{ name: string; at: number }[]>((placed, l) => {
                // keep labels at least one text line apart where lines end close together
                const prev = placed[placed.length - 1];
                placed.push({ ...l, at: prev && l.at - prev.at < 12 ? prev.at + 12 : l.at });
                return placed;
              }, [])
              .map((l) => (
                <text key={`l${l.name}`} x={width - PAD.r - 4} y={l.at} textAnchor="end" className="fill-[var(--fg)] font-mono text-[10.5px] font-medium">
                  {l.name}
                </text>
              ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" />
              {shown.map((s) => (
                <circle key={s.name} cx={hx} cy={y(s.y[hover])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[12px] shadow-pop"
            style={tipLeft ? { right: width - hx + 12 } : { left: hx + 12 }}
          >
            <div className="mb-1 font-mono text-[11px] text-muted">t = {fmt(t[hover] * tk)} {tu}</div>
            {shown.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="font-mono text-muted">V({s.name})</span>
                <span className="ml-auto pl-3 font-mono font-medium tabular text-fg">{fmt(s.y[hover])} V</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
