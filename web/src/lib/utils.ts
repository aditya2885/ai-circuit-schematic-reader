export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function duration(started: number | null, ended: number | null): string {
  if (!started) return "";
  const s = ((ended ?? Date.now() / 1000) - started);
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export const CATEGORY_LABEL: Record<string, string> = {
  voltage_source: "Voltage source",
  dc_voltage: "DC voltage source",
  ac_voltage: "AC voltage source",
  dc_current: "DC current source",
  current_source: "Current source",
  ic: "IC",
  led: "LED",
  mosfet: "MOSFET",
};

export const labelOf = (category: string) =>
  CATEGORY_LABEL[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (insecure context): fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function downloadText(text: string, filename: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: state lasts this session only */
  }
}
