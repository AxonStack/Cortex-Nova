import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string; // base64 data URL
}
import { useNovaStore } from "../store/novaStore";
import { WaveformAnimation } from "./WaveformAnimation";
import { StatusIndicator } from "./StatusIndicator";
import {
  getAllMemories, memoryCount, getTempMemory,
  getRecentSearches, getBehaviorPatterns,
  type Memory, type TempEntry, type BehaviorPattern,
} from "../lib/memory";
import type { ActionLogEntry, RecordedInputEvent } from "../store/novaStore";
import { TaskPlanPanel } from "./TaskPlanPanel";
import { getBinaryBrainStats, exportBinaryBrain, importBinaryBrain, resetBinaryBrain } from "../lib/binaryBrain";

interface NovaChatInterfaceProps {
  isHoldingSpace: boolean;
  voiceSupported: boolean | null;
  backgroundListening: boolean;
  ollamaConnected: boolean | null;
  onSubmitText: (text: string, attachments?: Attachment[]) => void;
  onToggleBackgroundListening: () => void;
  onClearChat: () => void;
  onResetSetup: () => void;
}

const QUICK_COMMANDS = [
  { label: "Iran US war news",   cmd: "get me articles about Iran US war" },
  { label: "Open YouTube",       cmd: "open youtube" },
  { label: "Search news",        cmd: "get me articles about latest tech news" },
  { label: "Open GitHub",        cmd: "open github" },
  { label: "What is AI?",        cmd: "what is artificial intelligence?" },
  { label: "Open Gmail",         cmd: "open gmail" },
];

function useUptime(sessionStart: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - sessionStart) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ActionTypeBadge({ type }: { type: ActionLogEntry["type"] }) {
  const styles: Record<ActionLogEntry["type"], string> = {
    os:       "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    ai:       "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    memory:   "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    research: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  };
  const labels: Record<ActionLogEntry["type"], string> = { os: "OS", ai: "AI", memory: "MEM", research: "RES" };
  return (
    <span className={`text-[9px] tracking-widest border px-1.5 py-0.5 rounded shrink-0 ${styles[type]}`}>
      {labels[type]}
    </span>
  );
}

export function NovaChatInterface({
  isHoldingSpace,
  voiceSupported,
  backgroundListening,
  ollamaConnected,
  onSubmitText,
  onToggleBackgroundListening,
  onClearChat,
  onResetSetup,
}: NovaChatInterfaceProps) {
  const {
    status, transcript, messages, errorMessage,
    providerConfig, theme, toggleTheme,
    actionLog, sessionStart, activePlan, permissions, setPermission, binaryBrain, setBinaryBrainEnabled,
    learnedMacros, saveMacro, deleteMacro,
  } = useNovaStore();

  const isWaveformActive = status === "listening" || status === "speaking";
  const isBusy = status === "listening" || status === "processing" || status === "speaking";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Memory state
  const [universalMems, setUniversalMems] = useState<Memory[]>([]);
  const [tempEntries, setTempEntries] = useState<TempEntry[]>([]);
  const [recentSearches, setRecentSearches] = useState<TempEntry[]>([]);
  const [behaviors, setBehaviors] = useState<BehaviorPattern[]>([]);
  const [totalMems, setTotalMems] = useState(0);

  // Active memory tab
  const [memTab, setMemTab] = useState<"universal" | "session" | "learned">("session");
  const [sidebarPage, setSidebarPage] = useState<"home" | "permissions" | "brain">("home");

  // Learning mode — when ON, polls input events every 15 s and auto-saves named segments
  const [learningMode, setLearningMode] = useState(false);

  const uptime = useUptime(sessionStart);

  useEffect(() => {
    setUniversalMems(getAllMemories().slice(0, 5));
    setTotalMems(memoryCount());
    setTempEntries(getTempMemory().slice(0, 8));
    setRecentSearches(getRecentSearches(5));
    setBehaviors(getBehaviorPatterns().slice(0, 5));
  }, [messages, actionLog]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function readFileAsDataUrl(file: File): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl: reader.result as string,
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const loaded = await Promise.all(files.map(readFileAsDataUrl));
    setAttachments((prev) => [...prev, ...loaded]);
    e.target.value = "";
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const loaded = await Promise.all(
      imageItems.map((item) => {
        const file = item.getAsFile();
        if (!file) return null;
        return readFileAsDataUrl(new File([file], `clipboard-${Date.now()}.png`, { type: item.type }));
      })
    );
    setAttachments((prev) => [...prev, ...(loaded.filter(Boolean) as Attachment[])]);
  }

  function handleSend() {
    const text = inputText.trim();
    if ((!text && attachments.length === 0) || isBusy) return;
    onSubmitText(text, attachments.length > 0 ? attachments : undefined);
    setInputText("");
    setAttachments([]);
  }

  const cfg = providerConfig;
  const isDark = theme === "dark";

  const providerNameMap: Record<typeof cfg.provider, string> = {
    ollama: `OLLAMA / ${cfg.ollamaModel.toUpperCase()}`,
    anthropic: "ANTHROPIC / CLAUDE",
    openai: "OPENAI / GPT-4O",
    claude_cli: "CLAUDE CODE CLI",
    codex_cli: "OPENAI CODEX CLI",
  };
  const providerName = providerNameMap[cfg.provider];

  const connDot = () => {
    if (cfg.provider === "ollama") {
      if (ollamaConnected === null)
        return <span className="w-2 h-2 rounded-full bg-black/30 dark:bg-white/20 animate-pulse shrink-0" />;
      return <span className={`w-2 h-2 rounded-full shrink-0 ${ollamaConnected ? "bg-green-500" : "bg-red-500"}`} />;
    }
    if (cfg.provider === "claude_cli" || cfg.provider === "codex_cli") {
      return <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />;
    }
    const hasKey = cfg.apiKey.length > 0;
    return <span className={`w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-green-500" : "bg-red-500"}`} />;
  };

  const connLabel =
    cfg.provider === "ollama"
      ? ollamaConnected === null ? "CHECKING…" : ollamaConnected ? "CONNECTED" : "UNREACHABLE"
      : cfg.provider === "claude_cli" || cfg.provider === "codex_cli"
      ? "CLI READY"
      : cfg.apiKey.length > 0 ? "KEY SET" : "KEY MISSING";

  const micLabel =
    isHoldingSpace ? "Listening…"
    : backgroundListening && status === "idle" ? 'Say "chop chop cortex"'
    : status === "processing" ? "Processing…"
    : status === "speaking" ? "Speaking…"
    : null;

  const aiMessages = messages.filter((m) => m.role === "ai" && m.latencyMs !== undefined);
  const avgLatency = aiMessages.length
    ? Math.round(aiMessages.reduce((a, m) => a + (m.latencyMs ?? 0), 0) / aiMessages.length)
    : null;

  const fmtMs = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  const entryTypeIcon: Record<TempEntry["type"], string> = {
    search: "⌕", open: "↗", command: "⌘", research: "◎", ai: "✦",
  };
  const brainStats = getBinaryBrainStats();

  function handleExportBrain() {
    const payload = exportBinaryBrain();
    navigator.clipboard?.writeText(payload).catch(() => {});
    window.alert("Binary brain exported. It has been copied to clipboard.");
  }

  function handleImportBrain() {
    const encoded = window.prompt("Paste binary brain payload:");
    if (!encoded) return;
    const ok = importBinaryBrain(encoded);
    window.alert(ok ? "Binary brain imported." : "Import failed. Invalid payload.");
    if (ok) setInputText((v) => v);
  }

  function handleResetBrain() {
    const ok = window.confirm("Reset local binary brain training data?");
    if (!ok) return;
    resetBinaryBrain();
    window.alert("Binary brain reset.");
    setInputText((v) => v);
  }

  function autoNameEvents(events: RecordedInputEvent[]): string {
    const keys = events.filter((e) => e.kind === "KeyPress").map((e) => e.key ?? "");
    const hasCtrlEnter = keys.some((k) => k === "Return") && keys.some((k) => k === "ControlLeft" || k === "ControlRight");
    const hasCtrlC = keys.some((k) => k === "KeyC") && keys.some((k) => k === "ControlLeft" || k === "ControlRight");
    const hasCtrlV = keys.some((k) => k === "KeyV") && keys.some((k) => k === "ControlLeft" || k === "ControlRight");
    const clicks = events.filter((e) => e.kind === "MouseClick").length;
    const letterKeys = keys.filter((k) => /^Key[A-Z]$/.test(k)).length;
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (hasCtrlEnter) return `Send / Submit — ${t}`;
    if (hasCtrlC && hasCtrlV) return `Copy-paste workflow — ${t}`;
    if (clicks > 8) return `Click-heavy workflow — ${t}`;
    if (letterKeys > 20) return `Typing workflow — ${t}`;
    return `Workflow at ${t}`;
  }

  useEffect(() => {
    if (!learningMode) {
      invoke("stop_input_recording").catch(() => {});
      return;
    }
    invoke("start_input_recording").catch(() => {});
    const interval = setInterval(async () => {
      try {
        const events = await invoke<RecordedInputEvent[]>("stop_input_recording");
        if (events.length > 3) {
          saveMacro({ name: autoNameEvents(events), events });
        }
        await invoke("start_input_recording");
      } catch {
        // silently skip failed poll cycles
      }
    }, 15000);
    return () => {
      clearInterval(interval);
      invoke("stop_input_recording").catch(() => {});
    };
  }, [learningMode]);

  return (
    <div className="h-screen bg-[#d8d8d8] dark:bg-[#0f0f0f] p-4 sm:p-6 font-mono flex flex-col transition-colors duration-200 overflow-hidden">
      <div className="flex-1 w-full rounded-[28px] border-2 border-black dark:border-[#3a3a3a] bg-[#dfdfdf] dark:bg-[#171717] shadow-[0_10px_0_#000] dark:shadow-[0_10px_0_#2a2a2a] p-2 flex flex-col min-h-0">
        <div className="relative flex-1 rounded-[20px] border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] p-3 sm:p-4 flex flex-col gap-3 min-h-0">
          {activePlan && (
            <div className="pointer-events-none absolute right-3 top-3 z-20 w-[min(360px,calc(100%-1.5rem))]">
              <div className="pointer-events-auto">
                <TaskPlanPanel
                  activePlan={activePlan}
                  compact
                  emptyLabel="Nova shows live progress here while it controls your desktop."
                />
              </div>
            </div>
          )}

          {/* Header */}
          <div className="rounded-[16px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] px-4 py-3 flex items-center justify-between gap-3 shrink-0 flex-wrap gap-y-2">
            <div className="flex items-center gap-3">
              <span className="text-[12px] tracking-[0.35em] uppercase text-black dark:text-[#e8e8e8] font-bold">CORTEX NOVA</span>
              <span className="px-3 py-1 text-[10px] tracking-[0.2em] uppercase border border-black dark:border-[#3a3a3a] rounded-full text-black/70 dark:text-white/60">
                Voice Assistant
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 border border-black dark:border-[#3a3a3a] rounded-full bg-[#ececec] dark:bg-[#242424]">
              {connDot()}
              <span className="text-[10px] tracking-[0.2em] uppercase text-black/70 dark:text-white/60">{providerName}</span>
              <span className="text-[10px] tracking-[0.15em] uppercase text-black/35 dark:text-white/30">— {connLabel}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                type="button"
                role="switch"
                aria-checked={backgroundListening}
                onClick={onToggleBackgroundListening}
                className={`flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase px-3 py-1.5 border rounded-full transition-colors ${
                  backgroundListening
                    ? "border-green-600/70 bg-green-500/15 text-green-700 dark:text-green-300"
                    : "border-black/30 dark:border-[#3a3a3a] text-black/60 dark:text-white/50 hover:border-black dark:hover:border-white/50"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${backgroundListening ? "bg-green-500 animate-pulse" : "bg-black/25 dark:bg-white/25"}`} />
                {backgroundListening ? "BG ON" : "BG OFF"}
              </button>
              <StatusIndicator status={status} />
              <button
                onClick={toggleTheme}
                className="text-[10px] tracking-[0.2em] uppercase px-3 py-1 border border-black/30 dark:border-[#3a3a3a] rounded-full hover:border-black dark:hover:border-white/50 transition-colors text-black/60 dark:text-white/50"
              >
                {isDark ? "☀ LIGHT" : "◑ DARK"}
              </button>
              <button
                onClick={onClearChat}
                className="text-[10px] tracking-[0.2em] uppercase px-2 py-1 border border-black/30 dark:border-[#3a3a3a] rounded-full hover:border-black dark:hover:border-white/50 transition-colors text-black/60 dark:text-white/50"
              >
                CLEAR
              </button>
              <button
                onClick={onResetSetup}
                className="text-[10px] tracking-[0.2em] uppercase px-2 py-1 border border-black/30 dark:border-[#3a3a3a] rounded-full hover:border-black dark:hover:border-white/50 transition-colors text-black/60 dark:text-white/50"
              >
                SETUP
              </button>
            </div>
          </div>

          {/* Page nav + content */}
          <div className="flex gap-3 flex-1 min-h-0">

          {/* Left nav */}
          <nav className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-2 flex flex-col gap-1.5 shrink-0 w-[58px]">
            {([
              { id: "home", label: "Home" },
              { id: "permissions", label: "Perms" },
              { id: "brain", label: "Brain" },
            ] as const).map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setSidebarPage(page.id)}
                className={`text-[8px] tracking-widest uppercase py-3 px-1 rounded-[10px] border transition-colors text-center leading-tight w-full ${
                  sidebarPage === page.id
                    ? "border-black dark:border-white bg-black dark:bg-white text-white dark:text-black"
                    : "border-black/20 dark:border-white/20 text-black/45 dark:text-white/35 hover:border-black/50 dark:hover:border-white/50"
                }`}
              >
                {page.label}
              </button>
            ))}
          </nav>

          {/* Permissions page */}
          {sidebarPage === "permissions" && (
            <div className="flex-1 rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-4 flex flex-col gap-3 overflow-y-auto">
              <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35">Access Controls</div>
              {([
                { key: "desktopAutomation", label: "Desktop Automation", detail: "Master switch for OS control tasks" },
                { key: "appControl", label: "Open/Close Apps", detail: "Allow launching and closing apps" },
                { key: "browserControl", label: "Browser Navigation", detail: "Allow opening URLs and web flows" },
                { key: "keyboardMouseControl", label: "Keyboard/Mouse", detail: "Allow typing, shortcuts, and clicks" },
              ] as const).map((item) => (
                <label key={item.key} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions[item.key]}
                    onChange={(e) => setPermission(item.key, e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] text-black/80 dark:text-white/65">{item.label}</div>
                    <div className="text-[10px] text-black/45 dark:text-white/35 mt-0.5">{item.detail}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Brain page */}
          {sidebarPage === "brain" && (
            <div className="flex-1 rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-4 flex flex-col gap-4 overflow-y-auto">

              {/* Binary Coprocessor */}
              <div className="flex flex-col gap-2">
                <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35">Binary Coprocessor</div>
                <label className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={binaryBrain.enabled}
                    onChange={(e) => setBinaryBrainEnabled(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-[12px] text-black/80 dark:text-white/65">Enable Binary Coprocessor</div>
                    <div className="text-[10px] text-black/45 dark:text-white/35 mt-0.5">Learns local intent patterns and adds planner hints.</div>
                  </div>
                </label>
                <div className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2.5">
                  <div className="text-[9px] tracking-widest uppercase text-black/35 dark:text-white/30">Trained samples</div>
                  <div className="text-[22px] font-bold text-black dark:text-[#e8e8e8] tabular-nums mt-0.5">{brainStats.trainedSamples}</div>
                  <div className="mt-2 text-[9px] text-black/45 dark:text-white/35 uppercase tracking-widest">Recent intents</div>
                  <div className="mt-1 space-y-1">
                    {brainStats.topIntents.slice(0, 4).map((intent) => (
                      <div key={intent} className="text-[11px] text-black/70 dark:text-white/55 line-clamp-1">{intent}</div>
                    ))}
                    {brainStats.topIntents.length === 0 && (
                      <div className="text-[11px] text-black/45 dark:text-white/35">No training data yet</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={handleExportBrain} className="flex-1 text-[10px] tracking-widest uppercase px-2 py-2 rounded-[10px] border border-black/30 dark:border-white/25 text-black/60 dark:text-white/50 hover:border-black dark:hover:border-white/50 transition-colors">Export</button>
                  <button type="button" onClick={handleImportBrain} className="flex-1 text-[10px] tracking-widest uppercase px-2 py-2 rounded-[10px] border border-black/30 dark:border-white/25 text-black/60 dark:text-white/50 hover:border-black dark:hover:border-white/50 transition-colors">Import</button>
                  <button type="button" onClick={handleResetBrain} className="flex-1 text-[10px] tracking-widest uppercase px-2 py-2 rounded-[10px] border border-red-500/40 text-red-700 dark:text-red-300 hover:border-red-600/60 transition-colors">Reset</button>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-black/10 dark:border-white/10" />

              {/* Macro Learning */}
              <div className="flex flex-col gap-2">
                <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35">Macro Learning</div>

                {/* Single toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={learningMode}
                  onClick={() => setLearningMode((v) => !v)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[10px] border transition-colors ${
                    learningMode
                      ? "border-green-600/60 bg-green-500/10"
                      : "border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424]"
                  }`}
                >
                  <div className="text-left">
                    <div className={`text-[11px] font-medium ${learningMode ? "text-green-700 dark:text-green-300" : "text-black/80 dark:text-white/65"}`}>
                      Learning Mode
                    </div>
                    <div className="text-[9px] text-black/45 dark:text-white/35 mt-0.5">
                      {learningMode ? "Watching your keyboard & mouse…" : "Tap to start learning your workflows"}
                    </div>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${learningMode ? "bg-green-500 animate-pulse" : "bg-black/25 dark:bg-white/25"}`} />
                </button>

                {/* Saved macros */}
                {learnedMacros.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    <div className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/25">{learnedMacros.length} learned</div>
                    {learnedMacros.map((macro) => (
                      <div key={macro.id} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-black/80 dark:text-white/65 truncate">{macro.name}</div>
                          <div className="text-[9px] text-black/35 dark:text-white/25">{macro.events.length} events · {new Date(macro.createdAt).toLocaleDateString()}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteMacro(macro.id)}
                          className="shrink-0 text-[9px] px-2 py-1 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:border-red-500/60 transition-colors"
                        >
                          Del
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {learnedMacros.length === 0 && !learningMode && (
                  <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-3 text-[10px] text-black/35 dark:text-white/25 text-center">
                    Enable learning mode and Cortex will start identifying your workflows automatically
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Home page */}
          {sidebarPage === "home" && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_310px] gap-3 flex-1 min-h-0">

            {/* Left: chat */}
            <div className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-3 flex flex-col min-h-0">
              <div className="text-[12px] tracking-[0.35em] uppercase text-black/75 dark:text-white/60 mb-3 shrink-0">Chat</div>

              {/* Waveform strip */}
              <div className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#e6e6e6] dark:bg-[#222] px-4 py-3 shadow-[0_6px_0_#000] dark:shadow-[0_6px_0_#2a2a2a] shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-black/60 dark:text-white/50">Live Session</span>
                  <span className="text-[10px] tracking-[0.2em] uppercase text-black/40 dark:text-white/35">
                    {backgroundListening
                      ? "WAKE READY"
                      : voiceSupported
                      ? "MIC READY"
                      : "TEXT ONLY"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <WaveformAnimation isActive={isWaveformActive} />
                  {micLabel && (
                    <span className="text-[11px] tracking-[0.15em] uppercase text-black/60 dark:text-white/50 animate-pulse">
                      {micLabel}
                    </span>
                  )}
                  {isHoldingSpace && transcript && (
                    <span className="text-[12px] text-black/70 dark:text-white/60 truncate max-w-[260px] italic">{transcript}</span>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="mt-3 flex-1 min-h-0 overflow-auto space-y-3 pr-1">
                {messages.length === 0 && !errorMessage && (
                  <div className="rounded-[14px] border border-dashed border-black/30 dark:border-white/15 px-4 py-4 text-[12px] tracking-[0.15em] uppercase text-black/35 dark:text-white/30 text-center mt-6">
                    {backgroundListening
                      ? 'Listening in background. Say "chop chop cortex" to wake Nova.'
                      : voiceSupported
                      ? 'Turn BG ON for wake word, hold SPACE to talk, or type below.'
                      : 'Type a command below. Try "get me articles about Iran US war"'}
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-[14px] border border-black dark:border-[#3a3a3a] p-3 ${
                      msg.role === "user"
                        ? "bg-[#f1f1f1] dark:bg-[#2a2a2a] ml-6"
                        : "bg-white dark:bg-[#1a1a1a] mr-6"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] tracking-[0.2em] uppercase text-black/45 dark:text-white/35">
                        {msg.role === "user" ? "You" : "Nova"}
                      </div>
                      {msg.latencyMs !== undefined && (
                        <div className="text-[9px] tracking-[0.15em] uppercase text-black/30 dark:text-white/25">
                          {fmtMs(msg.latencyMs)}
                        </div>
                      )}
                    </div>
                    <div className="text-[14px] text-black dark:text-[#e8e8e8] leading-relaxed">{msg.text}</div>
                  </div>
                ))}

                {errorMessage && (
                  <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#f7dede] dark:bg-[#3a1515] p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-black/45 dark:text-white/35 mb-1">Error</div>
                    <div className="text-[14px] text-black dark:text-[#e8e8e8] leading-relaxed">{errorMessage}</div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Right: sidebar */}
            <aside className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-3 flex flex-col gap-3 overflow-y-auto min-h-0">

              {/* Session stats */}
              <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-3 shrink-0">
                <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35 mb-2">Session</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { val: messages.length, label: "msgs" },
                    { val: messages.filter((m) => m.role === "user").length, label: "queries" },
                    { val: totalMems, label: "saved" },
                    { val: uptime, label: "uptime" },
                  ].map(({ val, label }) => (
                    <div key={label}>
                      <div className="text-[16px] font-bold text-black dark:text-[#e8e8e8] leading-none tabular-nums">{val}</div>
                      <div className="text-[9px] uppercase tracking-wide text-black/40 dark:text-white/30 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isBusy ? "bg-yellow-500 animate-pulse" : activePlan ? "bg-blue-500 animate-pulse" : backgroundListening ? "bg-green-500 animate-pulse" : "bg-black/30 dark:bg-white/25"}`} />
                    <span className="text-[9px] uppercase tracking-wide text-black/40 dark:text-white/30">
                      {activePlan
                        ? activePlan.type === "youtube_play" ? "PLAYING" : activePlan.type === "desktop_task" ? "WORKING" : "RESEARCHING"
                        : isBusy ? status.toUpperCase() : backgroundListening ? "BG LEARNING" : "IDLE"}
                    </span>
                  </div>
                  {avgLatency !== null && (
                    <span className="text-[9px] uppercase tracking-wide text-black/40 dark:text-white/30">
                      avg {fmtMs(avgLatency)}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Log */}
              <div className="shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45">Action Log</h3>
                  <span className="text-[10px] tracking-[0.15em] text-black/30 dark:text-white/25">{actionLog.length}</span>
                </div>
                {actionLog.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-2 text-[11px] text-black/35 dark:text-white/25">
                    Commands appear here
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                    {actionLog.map((entry) => (
                      <div key={entry.id} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-2.5 py-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ActionTypeBadge type={entry.type} />
                          <span className="text-[9px] text-black/30 dark:text-white/25 ml-auto tabular-nums">
                            {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                          {entry.latencyMs !== undefined && (
                            <span className="text-[9px] text-black/30 dark:text-white/25 tabular-nums">{fmtMs(entry.latencyMs)}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-black/75 dark:text-white/60 leading-snug line-clamp-2">{entry.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Workspace — memory with TEMP / PERM / AUTO */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35">Workspace</span>
                  <div className="flex gap-1">
                    {(["session", "universal", "learned"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setMemTab(tab)}
                        className={`text-[9px] tracking-widest uppercase px-2 py-0.5 rounded border transition-colors ${
                          memTab === tab
                            ? "border-black dark:border-white bg-black dark:bg-white text-white dark:text-black"
                            : "border-black/20 dark:border-white/20 text-black/40 dark:text-white/30 hover:border-black/50 dark:hover:border-white/50"
                        }`}
                      >
                        {tab === "session" ? "TEMP" : tab === "universal" ? "PERM" : "AUTO"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 space-y-1.5 min-h-0">
                  {/* TEMP */}
                  {memTab === "session" && (
                    <>
                      {recentSearches.length > 0 && (
                        <div className="rounded-[10px] border border-black/20 dark:border-white/10 px-2.5 py-2 mb-2">
                          <div className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/25 mb-1.5">Searches this session</div>
                          {recentSearches.map((e) => (
                            <div key={e.id} className="flex items-center gap-1.5 py-0.5">
                              <span className="text-[10px] text-black/30 dark:text-white/25">⌕</span>
                              <span className="text-[11px] text-black/65 dark:text-white/55 truncate">{e.content}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tempEntries.length === 0 ? (
                        <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-2 text-[11px] text-black/35 dark:text-white/25">
                          Session activity appears here
                        </div>
                      ) : (
                        tempEntries.map((e) => (
                          <div key={e.id} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-2.5 py-2 flex items-start gap-2">
                            <span className="text-[12px] text-black/35 dark:text-white/25 shrink-0 mt-0.5">{entryTypeIcon[e.type]}</span>
                            <div className="min-w-0">
                              <div className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/25">{e.type}</div>
                              <div className="text-[11px] text-black/75 dark:text-white/60 line-clamp-2">{e.content}</div>
                            </div>
                            <div className="text-[9px] text-black/25 dark:text-white/20 shrink-0 tabular-nums ml-auto">
                              {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {/* PERM */}
                  {memTab === "universal" && (
                    <>
                      <div className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/25 mb-1.5 px-0.5">
                        {totalMems} permanent memories
                      </div>
                      {universalMems.length === 0 ? (
                        <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-2 text-[11px] text-black/35 dark:text-white/25">
                          Say "remember that…" to store a fact
                        </div>
                      ) : (
                        universalMems.map((m) => (
                          <div key={m.id} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-2.5 py-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`text-[9px] tracking-widest uppercase ${m.src === "auto" ? "text-amber-500" : "text-black/30 dark:text-white/25"}`}>
                                {m.src === "auto" ? "AUTO-LEARNED" : m.src === "user" ? "USER" : "CMD"}
                              </span>
                              <span className="text-[9px] text-black/25 dark:text-white/20">{new Date(m.ts).toLocaleDateString()}</span>
                            </div>
                            <div className="text-[11px] text-black/75 dark:text-white/60 line-clamp-2">{m.text}</div>
                            {m.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {m.tags.slice(0, 4).map((t) => (
                                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/8 dark:bg-white/8 text-black/45 dark:text-white/35">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {/* AUTO */}
                  {memTab === "learned" && (
                    <>
                      <div className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/25 mb-1.5 px-0.5">
                        Topics Nova is learning about you
                      </div>
                      {behaviors.length === 0 ? (
                        <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-2 text-[11px] text-black/35 dark:text-white/25">
                          Nova learns your interests as you use it — search or research topics repeatedly
                        </div>
                      ) : (
                        behaviors.map((b) => (
                          <div key={b.topic} className="rounded-[10px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-2.5 py-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[11px] font-medium text-black dark:text-[#e8e8e8]">{b.topic}</span>
                              <div className="flex items-center gap-1.5">
                                {b.autoStored && (
                                  <span className="text-[8px] tracking-widest uppercase text-amber-500 border border-amber-500/30 px-1 rounded">AUTO</span>
                                )}
                                <span className="text-[9px] text-black/30 dark:text-white/25 tabular-nums">{b.count}×</span>
                              </div>
                            </div>
                            <div className="mt-1.5 h-1 rounded-full bg-black/10 dark:bg-white/10">
                              <div
                                className="h-full rounded-full bg-black/40 dark:bg-white/40 transition-all"
                                style={{ width: `${Math.min(100, (b.count / 10) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Quick commands */}
              <div className="shrink-0">
                <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45 mb-2">Quick Commands</h3>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_COMMANDS.map(({ label, cmd }) => (
                    <button
                      key={cmd}
                      onClick={() => { if (!isBusy) onSubmitText(cmd); }}
                      disabled={isBusy}
                      className="px-2.5 py-1 rounded-full border border-black/40 dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] text-[11px] text-black/70 dark:text-white/55 hover:border-black dark:hover:border-white/40 hover:bg-white dark:hover:bg-[#2a2a2a] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Connection */}
              <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-3 shrink-0">
                <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35 mb-2">Connection</div>
                <div className="flex items-center gap-2 mb-1">
                  {connDot()}
                  <span className="text-[12px] text-black/80 dark:text-white/65">{providerName}</span>
                </div>
                {cfg.provider === "ollama" && (
                  <div className="text-[10px] text-black/40 dark:text-white/30 break-all mb-1">{cfg.ollamaUrl}</div>
                )}
                <div className="text-[11px] uppercase tracking-wide text-black/45 dark:text-white/35">{connLabel}</div>
              </div>

            </aside>
          </div>

          {/* Input bar */}
          <div className="rounded-[16px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-2 shrink-0">
            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 px-1">
                {attachments.map((att) => (
                  <div key={att.id} className="relative group">
                    {att.mimeType.startsWith("image/") ? (
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        className="h-14 w-14 object-cover rounded-[8px] border border-black/30 dark:border-white/20"
                      />
                    ) : (
                      <div className="h-14 px-2 flex flex-col items-center justify-center rounded-[8px] border border-black/30 dark:border-white/20 bg-[#ececec] dark:bg-[#242424]">
                        <span className="text-[16px]">📄</span>
                        <span className="text-[8px] text-black/50 dark:text-white/40 truncate max-w-[56px]">{att.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black dark:bg-white text-white dark:text-black text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2 flex items-center gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,text/plain,text/markdown,.md"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              {/* Attach button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy || !!activePlan}
                title="Attach image or document"
                className="shrink-0 text-[16px] text-black/40 dark:text-white/35 hover:text-black dark:hover:text-white transition-colors disabled:opacity-30"
              >
                📎
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                onPaste={handlePaste}
                placeholder={
                  isHoldingSpace ? "Listening… release Space when done"
                  : isBusy ? "Processing…"
                  : activePlan ? activePlan.type === "youtube_play" ? "Playing media — please wait…" : activePlan.type === "desktop_task" ? "Desktop task running — please wait…" : "Researching — please wait…"
                  : 'Ask anything, attach an image, or paste from clipboard…'
                }
                disabled={isBusy || !!activePlan}
                className="flex-1 bg-transparent text-[12px] text-black dark:text-[#e8e8e8] placeholder-black/35 dark:placeholder-white/25 outline-none tracking-wide disabled:opacity-50"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={(!inputText.trim() && attachments.length === 0) || isBusy || !!activePlan}
                className="shrink-0 px-5 py-2 rounded-[12px] border border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-[12px] tracking-[0.2em] uppercase text-white dark:text-black transition-opacity disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-80"
              >
                Send
              </button>
            </div>
          </div>

          </div>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}
