import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { discoverPublicBackend, ENV_API_URL, liveService } from "./api";
import { demoService } from "./demo";
import type { CircuitService } from "./service";
import type { Conversation, Health, Message, Mode, Settings } from "./types";
import { readStorage, uid, writeStorage } from "./utils";

const CONV_KEY = "sr.conversations.v1";
const SETTINGS_KEY = "sr.settings.v1";

// "auto" (the GitHub Pages build): live when the local analysis server answers, demo otherwise,
// until the user picks a mode themselves.
const ENV_MODE = import.meta.env.VITE_DEFAULT_MODE;
const MANUAL_KEY = "sr.mode.manual";

const DEFAULT_SETTINGS: Settings = {
  mode: ENV_MODE === "live" || ENV_MODE === undefined ? "live" : "demo",
  apiUrl: ENV_API_URL,
  model: "qwen3-vl:8b-instruct",
  boxModel: "",
  maxSide: 1600,
  autoSimulink: true,
  theme: "dark",
  userName: "",
};

export type BackendState = { status: "checking" } | { status: "online"; health: Health } | { status: "offline"; error: string };

export interface Toast {
  id: string;
  tone: "ok" | "err" | "info";
  text: string;
}

interface Store {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  service: CircuitService;
  serviceFor(mode: Mode): CircuitService;
  backend: BackendState;
  recheckBackend(): void;

  conversations: Conversation[];
  active: Conversation | null;
  activeId: string | null;
  select(id: string | null): void;
  create(mode?: Mode): Conversation;
  patchConversation(id: string, patch: Partial<Conversation> | ((c: Conversation) => Partial<Conversation>)): void;
  addMessage(conversationId: string, message: Omit<Message, "id" | "created">): string;
  patchMessage(conversationId: string, messageId: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)): void;
  remove(id: string): void;

  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"]): void;
  dismissToast(id: string): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readStorage<Partial<Settings>>(SETTINGS_KEY, {}) }));
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    readStorage<Conversation[]>(CONV_KEY, []).map((c) => ({
      ...c,
      // a reply that was streaming when the page closed can never finish
      messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false, text: m.text || "(interrupted)" } : m)),
    })),
  );
  const [activeId, setActiveId] = useState<string | null>(() => readStorage<string | null>("sr.active", null));
  const [backend, setBackend] = useState<BackendState>({ status: "checking" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const persistTimer = useRef<number | undefined>(undefined);

  // Hosted site: use the public analysis server (Start-Public.bat) when one answers. Until that lookup is
  // done nothing is called, so visitors are not asked about their local network for a server they lack.
  const hosted = !!import.meta.env.VITE_HOSTED;
  const [discovered, setDiscovered] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(hosted);
  const discover = useCallback(async () => {
    if (!hosted) return;
    setDiscovered(await discoverPublicBackend());
    setDiscovering(false);
  }, [hosted]);
  useEffect(() => {
    void discover();
    const t = window.setInterval(() => void discover(), 5 * 60000);
    return () => window.clearInterval(t);
  }, [discover]);
  const userUrl = settings.apiUrl !== ENV_API_URL ? settings.apiUrl : "";
  const apiBase = userUrl || discovered || settings.apiUrl;

  const live = useMemo(() => liveService(apiBase), [apiBase]);
  const demo = useMemo(() => demoService(), []);
  const serviceFor = useCallback((mode: Mode) => (mode === "demo" ? demo : live), [demo, live]);
  const service = serviceFor(settings.mode);

  useEffect(() => writeStorage(SETTINGS_KEY, settings), [settings]);
  useEffect(() => writeStorage("sr.active", activeId), [activeId]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", settings.theme === "dark" ? "#0a0b0d" : "#f6f7f8");
    try {
      localStorage.setItem("sr.theme", settings.theme);
    } catch {
      /* ignore */
    }
  }, [settings.theme]);

  // Persist conversations, debounced: streaming replies update them many times a second.
  useEffect(() => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => writeStorage(CONV_KEY, conversations), 400);
  }, [conversations]);

  const check = useCallback(() => {
    const offline = (error: string) => {
      setBackend({ status: "offline", error });
      if (ENV_MODE === "auto" && !readStorage(MANUAL_KEY, false)) setSettings((s) => (s.mode === "demo" ? s : { ...s, mode: "demo" }));
    };
    // On the hosted site, a visitor's own PC has no analysis server: only the published one counts.
    if (hosted && !discovered && !userUrl) {
      offline("The analysis PC is not online right now.");
      return Promise.resolve();
    }
    return live
      .health()
      .then((health) => {
        setBackend({ status: "online", health });
        if (ENV_MODE === "auto" && !readStorage(MANUAL_KEY, false)) setSettings((s) => (s.mode === "live" ? s : { ...s, mode: "live" }));
      })
      .catch((err: Error) => offline(err.message));
  }, [live, hosted, discovered, userUrl]);
  const recheckBackend = useCallback(() => {
    setBackend({ status: "checking" });
    if (hosted) void discover();
    void check();
  }, [check, discover, hosted]);

  useEffect(() => {
    if (discovering) return;
    setBackend({ status: "checking" });
    void check();
    const t = window.setInterval(() => void check(), 15000);
    return () => window.clearInterval(t);
  }, [check, discovering]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const create = useCallback(
    (mode?: Mode) => {
      const now = Date.now();
      const conv: Conversation = { id: uid(), title: "New analysis", created: now, updated: now, saved: false, mode: mode ?? settings.mode, analysisId: null, messages: [] };
      setConversations((cs) => [conv, ...cs]);
      setActiveId(conv.id);
      return conv;
    },
    [settings.mode],
  );

  const patchConversation = useCallback<Store["patchConversation"]>((id, patch) => {
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));
  }, []);

  const addMessage = useCallback<Store["addMessage"]>((conversationId, message) => {
    const id = uid();
    const now = Date.now();
    setConversations((cs) =>
      cs.map((c) => (c.id === conversationId ? { ...c, updated: now, messages: [...c.messages, { ...message, id, created: now }] } : c)),
    );
    return id;
  }, []);

  const patchMessage = useCallback<Store["patchMessage"]>((conversationId, messageId, patch) => {
    setConversations((cs) =>
      cs.map((c) =>
        c.id === conversationId
          ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)) }
          : c,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setConversations((cs) => cs.filter((c) => c.id !== id));
    setActiveId((a) => (a === id ? null : a));
  }, []);

  const value: Store = {
    settings,
    updateSettings: (patch) => {
      if ("mode" in patch) writeStorage(MANUAL_KEY, true);
      setSettings((s) => ({ ...s, ...patch }));
    },
    service,
    serviceFor,
    backend,
    recheckBackend,
    conversations,
    active: conversations.find((c) => c.id === activeId) ?? null,
    activeId,
    select: setActiveId,
    create,
    patchConversation,
    addMessage,
    patchMessage,
    remove,
    toasts,
    toast,
    dismissToast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
