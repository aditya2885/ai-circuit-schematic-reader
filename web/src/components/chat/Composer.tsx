import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowUp, FileText, Loader2, Maximize2, Paperclip, RefreshCw, ScanLine, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { pdfToImage } from "../../lib/pdf";
import type { CircuitService } from "../../lib/service";
import type { Attachment } from "../../lib/types";
import { cn, formatBytes } from "../../lib/utils";
import { ImageViewer } from "../ui/ImageViewer";
import { Button, IconButton, Kbd, Modal, ModalHeader } from "../ui/primitives";

export const ACCEPT = ".jpg,.jpeg,.png,.pdf,.webp,.bmp,image/jpeg,image/png,image/webp,image/bmp,application/pdf";
const MAX_BYTES = 25 * 1024 * 1024;

/** Lets the page-wide drop zone (and sample cards) hand a file to the composer. */
export const offerFile = (file: File) => window.dispatchEvent(new CustomEvent<File>("sr:file", { detail: file }));

interface Pending {
  name: string;
  size: number;
  preview: string;
  status: "converting" | "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  fromPdf?: boolean;
  attachment?: Attachment;
}

interface Props {
  service: CircuitService;
  placeholder: string;
  streaming: boolean;
  onSend: (text: string) => void;
  onAnalyse: (attachment: Attachment, text: string) => void;
  onStop: () => void;
  autoFocus?: boolean;
  large?: boolean;
}

export function Composer({ service, placeholder, streaming, onSend, onAnalyse, onStop, autoFocus, large }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [viewing, setViewing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const token = useRef(0);

  const attach = useCallback(
    async (file: File) => {
      const my = ++token.current;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage = /^image\/(png|jpeg|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
      const base: Pending = { name: file.name, size: file.size, preview: "", status: "converting", progress: 0, fromPdf: isPdf };
      if (!isPdf && !isImage) {
        setPending({ ...base, status: "error", error: "Unsupported file. Use JPG, PNG or PDF." });
        return;
      }
      if (file.size > MAX_BYTES) {
        setPending({ ...base, status: "error", error: "The file is larger than 25 MB." });
        return;
      }
      let image = file;
      if (isPdf) {
        setPending(base);
        try {
          image = (await pdfToImage(file)).image;
        } catch (err) {
          if (my === token.current) setPending({ ...base, status: "error", error: `Could not read the PDF: ${(err as Error).message}` });
          return;
        }
      }
      const preview = URL.createObjectURL(image);
      if (my !== token.current) return;
      setPending({ ...base, preview, status: "uploading" });
      try {
        const meta = await service.upload(image, isPdf ? `${file.name} (page 1)` : file.name, (p) => {
          if (my === token.current) setPending((x) => (x ? { ...x, progress: p } : x));
        });
        if (my !== token.current) return;
        setPending((x) => x && {
          ...x,
          status: "ready",
          progress: 1,
          attachment: { name: meta.name, size: file.size, url: meta.url, uploadId: meta.id, width: meta.width, height: meta.height, fromPdf: isPdf },
        });
        area.current?.focus();
      } catch (err) {
        if (my === token.current) setPending((x) => x && { ...x, status: "error", error: (err as Error).message });
      }
    },
    [service],
  );

  useEffect(() => {
    const onFile = (e: Event) => void attach((e as CustomEvent<File>).detail);
    window.addEventListener("sr:file", onFile);
    return () => window.removeEventListener("sr:file", onFile);
  }, [attach]);

  // Grow the textarea with its content, up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    el.style.overflowY = el.scrollHeight > 220 ? "auto" : "hidden";
  }, [text]);

  const clear = () => {
    token.current++;
    setPending(null);
  };

  const ready = pending?.status === "ready" && pending.attachment;
  const busy = pending && (pending.status === "uploading" || pending.status === "converting");
  const canSend = !streaming && !busy && (ready || text.trim().length > 0);

  const submit = () => {
    if (!canSend) return;
    if (ready && pending?.attachment) {
      onAnalyse(pending.attachment, text.trim());
      setPending(null);
    } else {
      onSend(text.trim());
    }
    setText("");
  };

  return (
    <div className={cn("rounded-2xl border border-line-strong bg-surface shadow-card transition-shadow focus-within:border-[color-mix(in_oklab,var(--accent),transparent_55%)] focus-within:shadow-[0_0_0_4px_var(--accent-soft)]")}>
      <AnimatePresence initial={false}>
        {pending && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex items-center gap-3 p-3 pb-0">
              <button
                onClick={() => pending.preview && setViewing(true)}
                disabled={!pending.preview}
                className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-line bg-white"
                aria-label="Preview schematic"
              >
                {pending.preview ? (
                  <img src={pending.preview} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center bg-surface-2 text-muted"><FileText className="size-6" /></span>
                )}
                {pending.preview && <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 className="size-4 text-white" /></span>}
                {busy && (
                  <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/30">
                    <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(8, pending.progress * 100)}%` }} />
                  </span>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{pending.name}</div>
                <div className={cn("mt-0.5 flex items-center gap-1.5 text-[12px]", pending.status === "error" ? "text-err" : "text-muted")}>
                  {pending.status === "converting" && (<><Loader2 className="size-3 animate-spin" />Rendering PDF page 1…</>)}
                  {pending.status === "uploading" && (<><Loader2 className="size-3 animate-spin" />Uploading · {Math.round(pending.progress * 100)}%</>)}
                  {pending.status === "ready" && (<>{formatBytes(pending.size)}{pending.fromPdf && " · page 1 of PDF"}{pending.attachment?.width ? ` · ${pending.attachment.width}×${pending.attachment.height}` : ""} · <span className="text-ok">ready</span></>)}
                  {pending.status === "error" && (<><AlertCircle className="size-3 shrink-0" /><span className="truncate" title={pending.error}>{pending.error}</span></>)}
                </div>
              </div>
              <IconButton size="sm" label="Replace file" onClick={() => input.current?.click()}><RefreshCw className="size-4" /></IconButton>
              <IconButton size="sm" label="Remove file" onClick={clear}><X className="size-4" /></IconButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        ref={area}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/") || f.type === "application/pdf");
          if (file) {
            e.preventDefault();
            void attach(file);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={pending ? "Add an instruction or question (optional)…" : placeholder}
        className={cn("block w-full resize-none bg-transparent px-4 text-[15px] leading-relaxed outline-none focus-visible:outline-none placeholder:text-faint", large ? "pt-4 pb-2 min-h-[64px]" : "pt-3.5 pb-1.5")}
      />

      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <IconButton label="Attach schematic (JPG, PNG, PDF)" onClick={() => input.current?.click()}><Paperclip className="size-[18px]" /></IconButton>
        <span className="hidden text-[11.5px] text-faint sm:inline">JPG, PNG or PDF · drop anywhere · <Kbd>Enter</Kbd> to send</span>
        <div className="flex-1" />
        {streaming ? (
          <Button size="sm" variant="secondary" icon={<Square className="size-3 fill-current" />} onClick={onStop}>Stop</Button>
        ) : pending ? (
          <Button size="sm" variant="primary" disabled={!canSend} icon={busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />} onClick={submit}>
            Analyse schematic
          </Button>
        ) : (
          <IconButton
            label="Send"
            onClick={submit}
            disabled={!canSend}
            className={cn("!rounded-xl", canSend ? "!bg-accent !text-accent-fg hover:!bg-accent-strong" : "!bg-surface-3 !text-faint")}
          >
            <ArrowUp className="size-[18px]" />
          </IconButton>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = "";
        }}
      />

      <Modal open={viewing && !!pending?.preview} onClose={() => setViewing(false)} label="Schematic preview" className="max-w-5xl">
        <ModalHeader title={pending?.name} subtitle="Scroll to zoom · drag to pan" onClose={() => setViewing(false)} />
        <div className="p-3">{pending?.preview && <ImageViewer src={pending.preview} alt={pending.name} className="h-[70vh]" />}</div>
      </Modal>
    </div>
  );
}
