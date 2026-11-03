import { motion } from "framer-motion";
import { CheckCircle2, CircleAlert, Maximize2, Zap } from "lucide-react";
import { useState } from "react";
import type { CircuitService } from "../../lib/service";
import type { Attachment, Conversation, Message } from "../../lib/types";
import { cn, formatBytes } from "../../lib/utils";
import { AnalysisMessage } from "../analysis/AnalysisMessage";
import { ImageViewer } from "../ui/ImageViewer";
import { Markdown } from "../ui/Markdown";
import { Badge, CopyButton, Logo, Modal, ModalHeader } from "../ui/primitives";

function AttachmentCard({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group block overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-card transition-transform hover:-translate-y-0.5">
      <div className="relative bg-white">
        <img src={a.url} alt={a.name} className="max-h-72 w-full max-w-[420px] object-contain" />
        <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"><Maximize2 className="size-4" /></span>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px]">
        <span className="truncate font-medium">{a.name}</span>
        <span className="ml-auto shrink-0 text-faint">{[a.size ? formatBytes(a.size) : "", a.width ? `${a.width}×${a.height}` : ""].filter(Boolean).join(" · ")}</span>
      </div>
    </button>
  );
}

function AssistantText({ m }: { m: Message }) {
  if (m.kind === "error")
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--err),transparent_70%)] bg-err-soft px-3.5 py-2.5 text-[13.5px]">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-err" />
        <span className="leading-relaxed">{m.text}</span>
      </div>
    );
  return (
    <div className="space-y-2">
      {m.action && (
        <div className={cn("inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]", m.action.tone === "ok" ? "border-[color-mix(in_oklab,var(--ok),transparent_70%)] bg-ok-soft" : "border-[color-mix(in_oklab,var(--info),transparent_70%)] bg-info-soft")}>
          {m.action.tone === "ok" ? <CheckCircle2 className="size-3.5 text-ok" /> : <Zap className="size-3.5 text-info" />}
          <span className="font-medium">{m.action.label}</span>
          {m.action.detail && <span className="font-mono text-muted">{m.action.detail}</span>}
        </div>
      )}
      {m.text || !m.streaming ? (
        <Markdown text={m.text} streaming={m.streaming} />
      ) : (
        <div className="flex h-6 items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="size-1.5 rounded-full bg-muted" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
          ))}
        </div>
      )}
      {!m.streaming && m.text && (
        <div className="-ml-2 opacity-0 transition-opacity group-hover/msg:opacity-100"><CopyButton text={m.text} /></div>
      )}
    </div>
  );
}

interface Props {
  conv: Conversation;
  service: CircuitService;
  onFollowUp: (text: string) => void;
}

export function MessageList({ conv, service, onFollowUp }: Props) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  return (
    <div className="space-y-7">
      {conv.messages.map((m) => (
        <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
          {m.role === "user" ? (
            <div className="flex flex-col items-end gap-2">
              {m.attachments?.map((a, i) => <AttachmentCard key={i} a={a} onOpen={() => setViewing(a)} />)}
              {m.text && <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap">{m.text}</div>}
            </div>
          ) : (
            <div className="group/msg flex gap-3">
              <div className="mt-0.5 shrink-0"><Logo size={28} /></div>
              <div className="min-w-0 flex-1 pt-0.5">
                {m.kind === "analysis" ? (
                  <AnalysisMessage conv={conv} message={m} service={service} onFollowUp={onFollowUp} />
                ) : (
                  <AssistantText m={m} />
                )}
              </div>
            </div>
          )}
        </motion.div>
      ))}
      {conv.mode === "demo" && conv.messages.length > 0 && (
        <div className="flex justify-center"><Badge tone="info">Demo conversation · saved sample data, no live model</Badge></div>
      )}
      <Modal open={!!viewing} onClose={() => setViewing(null)} label="Schematic" className="max-w-6xl">
        <ModalHeader title={viewing?.name} subtitle="Scroll to zoom · drag to pan · double-click to zoom in" onClose={() => setViewing(null)} />
        <div className="p-3">{viewing && <ImageViewer src={viewing.url} alt={viewing.name} className="h-[76vh]" />}</div>
      </Modal>
    </div>
  );
}
