import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, Cable, Cpu, FileCode2, FlaskConical, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_APP } from "../../lib/api";
import { useConversationActions } from "../../lib/actions";
import { DEMO_SAMPLES } from "../../lib/demo";
import { useStore } from "../../lib/store";
import type { Attachment, Conversation } from "../../lib/types";
import { greeting } from "../../lib/utils";
import { Badge, Button } from "../ui/primitives";
import { Composer, offerFile } from "./Composer";
import { MessageList } from "./MessageList";

const LIVE_SAMPLES = [
  { file: "handwritten.jpeg", title: "Hand-drawn RC circuit", subtitle: "Pen sketch on paper" },
  { file: "handwritten1.jpeg", title: "Sketch with a lamp", subtitle: "Five parts in parallel" },
  { file: "inverter.png", title: "H-bridge inverter", subtitle: "Printed, thyristor bridge" },
  { file: "circuit.png", title: "Resistor network", subtitle: "Printed textbook figure" },
];

const CAPABILITIES = [
  { icon: <ScanSearch className="size-4" />, title: "Reads the drawing", text: "Parts, values and labels, printed or hand-drawn" },
  { icon: <Cable className="size-4" />, title: "Traces the wires", text: "Connections confirmed from the pixels" },
  { icon: <FileCode2 className="size-4" />, title: "Builds the netlist", text: "Editable components, nets and BOM" },
  { icon: <Cpu className="size-4" />, title: "Generates Simulink", text: "Simscape model, simulated and checked" },
];

export function ChatView() {
  const store = useStore();
  const { active, settings, serviceFor, create, toast } = store;
  const { ask, analyse, stop, isStreaming } = useConversationActions();
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const conv = active;
  const mode = conv?.mode ?? settings.mode;
  const service = serviceFor(mode);

  const ensure = useCallback((): Conversation => conv ?? create(), [conv, create]);
  const onSend = (text: string) => void ask(ensure(), text);
  const onAnalyse = (a: Attachment, text: string) => void analyse(ensure(), a, text);
  const onFollowUp = useCallback((text: string) => conv && void ask(conv, text, { showUser: false }), [ask, conv]);

  // Keep the newest message in view while the user is at the bottom.
  const last = conv?.messages[conv.messages.length - 1];
  const lastSig = `${conv?.id}:${conv?.messages.length}:${last?.text.length}:${last?.analysisId}`;
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastSig, atBottom]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, [conv?.id]);
  // Content also grows without new messages (workflow steps, results): follow it while at the bottom.
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  stick.current = atBottom;
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = scroller.current;
      if (s && stick.current) s.scrollTop = s.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [conv?.id, conv?.messages.length]);

  const openDemo = (key: string) => {
    const s = DEMO_SAMPLES.find((d) => d.key === key)!;
    const c = conv && conv.mode === "demo" && !conv.messages.length ? conv : create("demo");
    void analyse(c, { name: s.file, size: 0, url: s.image, uploadId: `demo-${key}` }, "");
  };

  const loadSample = async (file: string) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      offerFile(new File([blob], file, { type: blob.type }));
    } catch {
      toast("Could not load the sample image", "err");
    }
  };

  const streaming = isStreaming(conv);
  const hasAnalysis = !!conv?.analysisId;
  const placeholder = hasAnalysis
    ? "Ask about this circuit, or say “change R1 to 10 ohms” or “generate the MATLAB model”…"
    : "Upload your circuit schematic or describe what you want to analyse...";

  const composer = (large?: boolean) => (
    <Composer service={service} placeholder={placeholder} streaming={streaming} onSend={onSend} onAnalyse={onAnalyse} onStop={() => conv && stop(conv)} autoFocus large={large} />
  );

  if (!conv || conv.messages.length === 0)
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="welcome-glow pointer-events-none absolute inset-0" />
        <div className="bg-grid grid-fade pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10 sm:py-16">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-7 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12px] text-muted backdrop-blur">
              <span className="size-1.5 rounded-full bg-accent" /> Qwen3-VL · wire tracing · Simscape
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">{greeting(settings.userName)}</h1>
            <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-muted">
              Drop in a circuit schematic. I'll read every part and value, trace the connections and build a Simulink model you can simulate.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06 }}>
            {composer(true)}
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.15 }} className="mt-8">
            {mode === "demo" ? (
              <>
                <div className="mb-2.5 flex items-center gap-2 text-[12.5px] text-muted"><FlaskConical className="size-3.5 text-info" />Demo mode: open a saved analysis <Badge tone="info">sample data</Badge></div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {DEMO_SAMPLES.map((s) => (
                    <button key={s.key} onClick={() => openDemo(s.key)} className="group flex items-center gap-3 rounded-xl border border-line bg-surface/80 p-2.5 text-left backdrop-blur transition-all hover:border-line-strong hover:bg-surface">
                      <img src={s.image} alt="" className="size-14 rounded-lg border border-line bg-white object-cover" />
                      <div className="min-w-0"><div className="text-[13.5px] font-medium">{s.title}</div><div className="truncate text-[12px] text-muted">{s.subtitle}</div></div>
                    </button>
                  ))}
                </div>
                {import.meta.env.VITE_HOSTED && (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-line bg-surface/80 p-3 text-[12.5px] leading-relaxed text-muted backdrop-blur">
                    <Cpu className="mt-0.5 size-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-fg">Live analysis is offline right now.</span> The vision model and MATLAB run on the project's analysis PC; while it is offline this page shows saved demo analyses, and it switches to <b className="font-medium text-fg">Live</b> by itself when the PC comes online.
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {import.meta.env.VITE_REPO_URL && (
                          <a className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[12.5px] font-medium text-fg hover:bg-surface-2" href={import.meta.env.VITE_REPO_URL} target="_blank" rel="noreferrer">Project on GitHub</a>
                        )}
                        <a href={LIVE_APP} className="text-[12px] text-faint underline underline-offset-2 hover:text-fg">On the analysis PC? Open the local app</a>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-2.5 text-[12.5px] text-muted">Or try one of these schematics</div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {LIVE_SAMPLES.map((s) => (
                    <button key={s.file} onClick={() => loadSample(s.file)} className="group overflow-hidden rounded-xl border border-line bg-surface/80 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-line-strong">
                      <div className="h-20 overflow-hidden bg-white"><img src={`${import.meta.env.BASE_URL}samples/${s.file}`} alt="" className="size-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-105" /></div>
                      <div className="px-2.5 py-2"><div className="truncate text-[12.5px] font-medium">{s.title}</div><div className="truncate text-[11.5px] text-faint">{s.subtitle}</div></div>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="text-[12.5px]">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-fg"><span className="text-accent">{c.icon}</span>{c.title}</div>
                  <div className="leading-relaxed text-faint">{c.text}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        <div ref={content} className="mx-auto w-full max-w-4xl px-3 pb-8 pt-6 sm:px-6">
          <MessageList conv={conv} service={service} onFollowUp={onFollowUp} />
        </div>
      </div>
      <AnimatePresence>
        {!atBottom && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="pointer-events-none absolute inset-x-0 bottom-36 flex justify-center">
            <Button size="sm" variant="secondary" className="pointer-events-auto rounded-full shadow-pop" icon={<ArrowDown className="size-3.5" />}
              onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}>
              Latest
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="shrink-0 bg-gradient-to-t from-bg via-bg to-transparent px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
        <div className="mx-auto max-w-3xl">
          {composer()}
          <p className="mt-2 text-center text-[11px] text-faint">Machine-read results can be wrong. Check parts flagged “Check” against your drawing.</p>
        </div>
      </div>
    </div>
  );
}
