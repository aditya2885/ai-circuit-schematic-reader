import { useCallback, useRef } from "react";
import { QUESTION_RE } from "./circuit";
import { useStore } from "./store";
import type { Attachment, Conversation } from "./types";
import { refreshAnalysis } from "./useAnalysis";

const GENERIC = /^\s*(please\s+)?(analy[sz]e|read|process|scan|check)( (this|the|my))?( (circuit|schematic|image|drawing|diagram))?\s*[.!]?\s*$/i;

/** What the user can do in a conversation: analyse an attached schematic, ask a follow-up, stop a reply. */
export function useConversationActions() {
  const store = useStore();
  const { settings, serviceFor, addMessage, patchMessage, patchConversation, toast } = store;
  const controllers = useRef(new Map<string, AbortController>());

  const ask = useCallback(
    async (conv: Conversation, text: string, opts: { showUser?: boolean } = {}) => {
      const service = serviceFor(conv.mode);
      if (opts.showUser !== false) addMessage(conv.id, { role: "user", kind: "text", text });
      if (conv.messages.length === 0) patchConversation(conv.id, { title: text.slice(0, 60) });
      const history = conv.messages
        .filter((m) => m.kind === "text" && m.text && !m.streaming)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.text }));
      const replyId = addMessage(conv.id, { role: "assistant", kind: "text", text: "", streaming: true });
      const ctrl = new AbortController();
      controllers.current.set(conv.id, ctrl);
      let errored = false;
      try {
        await service.chat(
          { message: text, analysis_id: conv.analysisId, history, model: settings.model },
          (e) => {
            if (e.type === "token") patchMessage(conv.id, replyId, (m) => ({ text: m.text + e.text }));
            else if (e.type === "action" && e.action === "edit") {
              patchMessage(conv.id, replyId, { action: { label: `${e.designator} ${e.field}`, detail: `${e.old} → ${e.new}`, tone: "ok" } });
              if (conv.analysisId) void refreshAnalysis(service, conv.analysisId);
            } else if (e.type === "action" && e.action === "simulink") {
              patchMessage(conv.id, replyId, { action: { label: e.status === "opened" ? "MATLAB" : "Simulink build", detail: e.status, tone: "info" } });
              if (conv.analysisId) void refreshAnalysis(service, conv.analysisId);
            } else if (e.type === "error") {
              errored = true;
              patchMessage(conv.id, replyId, { kind: "error", text: e.message });
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          patchMessage(conv.id, replyId, (m) => ({ text: m.text ? `${m.text}\n\n*Stopped.*` : "*Stopped.*" }));
        } else {
          errored = true;
          patchMessage(conv.id, replyId, { kind: "error", text: (err as Error).message });
        }
      } finally {
        controllers.current.delete(conv.id);
        patchMessage(conv.id, replyId, (m) => ({ streaming: false, text: m.text || (errored ? m.text : "(no answer)") }));
      }
    },
    [addMessage, patchConversation, patchMessage, serviceFor, settings.model],
  );

  const analyse = useCallback(
    async (conv: Conversation, attachment: Attachment, instruction: string) => {
      const service = serviceFor(conv.mode);
      addMessage(conv.id, { role: "user", kind: "text", text: instruction, attachments: [attachment] });
      if (conv.messages.length === 0) patchConversation(conv.id, { title: attachment.name.replace(/\.[^.]+$/, "") });
      const followUp = instruction && !GENERIC.test(instruction) && (QUESTION_RE.test(instruction) || instruction.trim().endsWith("?")) ? instruction : "";
      const msgId = addMessage(conv.id, { role: "assistant", kind: "analysis", text: followUp, streaming: true });
      try {
        if (!attachment.uploadId) throw new Error("The image has not finished uploading.");
        const analysis = await service.startAnalysis(attachment.uploadId, {
          model: settings.model,
          box_model: settings.boxModel || null,
          max_side: settings.maxSide,
          simulink: settings.autoSimulink,
        });
        patchMessage(conv.id, msgId, { analysisId: analysis.id });
        patchConversation(conv.id, { analysisId: analysis.id });
      } catch (err) {
        patchMessage(conv.id, msgId, { kind: "error", streaming: false, text: (err as Error).message });
        toast("Analysis could not start", "err");
      }
    },
    [addMessage, patchConversation, patchMessage, serviceFor, settings, toast],
  );

  const stop = useCallback((conv: Conversation) => controllers.current.get(conv.id)?.abort(), []);
  const isStreaming = (conv: Conversation | null) => !!conv && conv.messages.some((m) => m.streaming && m.kind === "text");

  return { ask, analyse, stop, isStreaming };
}
