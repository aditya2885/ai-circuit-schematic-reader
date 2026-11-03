import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, CircuitBoard, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CircuitService } from "../../lib/service";
import { useStore } from "../../lib/store";
import type { Conversation, Message } from "../../lib/types";
import { useAnalysis } from "../../lib/useAnalysis";
import { cn } from "../../lib/utils";
import { ResultsPanel } from "../results/ResultsPanel";
import { Badge, Button, Spinner } from "../ui/primitives";
import { Workflow } from "./Workflow";

/** Reveals already-received text word by word, like a streamed reply. */
function Reveal({ text, animate }: { text: string; animate: boolean }) {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(animate ? 0 : words.length);
  useEffect(() => {
    if (n >= words.length) return;
    const t = window.setTimeout(() => setN((x) => Math.min(words.length, x + 3)), 28);
    return () => window.clearTimeout(t);
  }, [n, words.length]);
  return <span className={n < words.length ? "caret" : undefined}>{words.slice(0, n).join("")}</span>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "ok" | "err" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={cn("mt-0.5 truncate text-[17px] font-semibold tabular tracking-tight", tone === "warn" && "text-warn", tone === "ok" && "text-ok", tone === "err" && "text-err")}>{value}</div>
    </div>
  );
}

interface Props {
  conv: Conversation;
  message: Message;
  service: CircuitService;
  onFollowUp: (text: string) => void;
}

export function AnalysisMessage({ conv, message, service, onFollowUp }: Props) {
  const { patchMessage, patchConversation, toast } = useStore();
  const { analysis, error } = useAnalysis(service, message.analysisId);
  const [showSteps, setShowSteps] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const finishedHere = useRef(false);

  const done = analysis?.status === "done";
  const finished = analysis && ["done", "error", "rejected"].includes(analysis.status);

  // When the analysis ends: stop the "working" state and ask the user's own question, if they attached one.
  useEffect(() => {
    if (!finished || !message.streaming) return;
    finishedHere.current = true;
    patchMessage(conv.id, message.id, { streaming: false });
    if (done && analysis.title) patchConversation(conv.id, (c) => (c.title === analysis.file.name.replace(/\.[^.]+$/, "") ? { title: `${analysis.title} · ${c.title}` } : {}));
    if (done && message.text) onFollowUp(message.text);
  }, [finished, done, message.streaming, message.text, message.id, conv.id, patchMessage, patchConversation, onFollowUp, analysis]);

  const retry = async () => {
    if (!analysis) return;
    setRetrying(true);
    try {
      const a = await service.startAnalysis(analysis.file.id, analysis.options as never);
      patchMessage(conv.id, message.id, { analysisId: a.id, streaming: true, text: "" });
      patchConversation(conv.id, { analysisId: a.id });
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setRetrying(false);
    }
  };

  if (!message.analysisId)
    return (
      <div className="flex items-center gap-2.5 text-[13.5px] text-muted">
        <Spinner className="text-accent" /> <span className="shimmer">Starting the analysis…</span>
      </div>
    );
  if (!analysis)
    return error ? (
      <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px] text-muted"><XCircle className="mr-1.5 inline size-4 text-err" />{error}</div>
    ) : (
      <div className="flex items-center gap-2.5 text-[13.5px] text-muted"><Spinner /> Loading analysis…</div>
    );

  const total = analysis.stages.reduce((s, x) => (x.started && x.ended ? s + (x.ended - x.started) : s), 0);
  const stepsOpen = showSteps ?? !done;
  const r = analysis.result;
  const warn = r ? r.components.filter((c) => c.evidence?.level === "check").length : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="font-medium">{done ? "Analysis complete" : analysis.status === "rejected" ? "Not a schematic" : analysis.status === "error" ? "Analysis failed" : analysis.status === "queued" ? "Queued" : "Analysing schematic"}</span>
        <span className="truncate text-muted">· {analysis.file.name}</span>
        {analysis.demo && <Badge tone="info">Demo replay of a saved run</Badge>}
        {!finished && <Spinner className="text-accent" />}
      </div>

      {done ? (
        <button onClick={() => setShowSteps(!stepsOpen)} className="flex items-center gap-2 text-[12.5px] text-muted hover:text-fg">
          <ChevronDown className={cn("size-3.5 transition-transform", stepsOpen && "rotate-180")} />
          {stepsOpen ? "Hide" : "Show"} the {analysis.stages.length} processing steps{total > 0 && ` · ${total < 60 ? `${total.toFixed(0)}s` : `${Math.floor(total / 60)}m ${Math.round(total % 60)}s`}`}
        </button>
      ) : null}
      <AnimatePresence initial={false}>
        {stepsOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <Workflow stages={analysis.stages} />
          </motion.div>
        )}
      </AnimatePresence>

      {analysis.status === "rejected" && (
        <div className="flex gap-3 rounded-xl border border-[color-mix(in_oklab,var(--warn),transparent_70%)] bg-warn-soft p-3.5 text-[13px]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div><div className="font-medium">The image was not accepted as a circuit schematic.</div><div className="mt-0.5 text-muted">{analysis.error}</div></div>
        </div>
      )}
      {analysis.status === "error" && (
        <div className="rounded-xl border border-[color-mix(in_oklab,var(--err),transparent_70%)] bg-err-soft p-3.5">
          <div className="flex items-start gap-2 text-[13px]"><XCircle className="mt-0.5 size-4 shrink-0 text-err" /><div className="min-w-0 flex-1"><div className="font-medium">The pipeline reported an error</div>
            <pre className="mt-1.5 max-h-48 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">{analysis.error}</pre></div></div>
          {!analysis.demo && <Button size="sm" variant="secondary" className="mt-3" icon={<RotateCcw className="size-3.5" />} loading={retrying} onClick={retry}>Run again</Button>}
        </div>
      )}

      {done && r && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <CircuitBoard className="size-4 text-accent" />
              <h3 className="text-[15px] font-semibold tracking-tight">{r.circuit_type || "Circuit"}</h3>
              {r.drawing_style && <Badge>{r.drawing_style.replace("_", "-")}</Badge>}
              {r.edited && <Badge tone="info">edited</Badge>}
            </div>
            <p className="text-[14.5px] leading-relaxed text-fg/90">
              <Reveal text={r.summary} animate={finishedHere.current} />
            </p>
            {r.topology && <p className="text-[13px] leading-relaxed text-muted"><span className="text-faint">Topology: </span>{r.topology}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Parts" value={r.components.length} />
            <Stat label="Nets" value={r.connections.filter((c) => !["unknown", "NC"].includes(c.net)).length} />
            <Stat label="To check" value={warn} tone={warn ? "warn" : "ok"} />
            <Stat label="Wire tracing" value={r.tracing_used ? "Used" : "Not used"} tone={r.tracing_used ? "ok" : "warn"} />
          </div>
          {!r.tracing_used && (
            <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Connections are the vision model's own reading; the wire tracer could not confirm them. Check the Connections tab against the drawing.
            </p>
          )}
          <ResultsPanel service={service} analysis={analysis} />
          <p className="text-[12px] text-faint">Ask a question about this circuit, say “change R1 to 10 ohms”, or “generate the MATLAB model”.</p>
        </motion.div>
      )}
    </div>
  );
}
