import { useEffect, useRef, useState } from "react";
import { useNovaStore } from "../store/novaStore";
import { WaveformAnimation } from "./WaveformAnimation";
import { StatusIndicator } from "./StatusIndicator";
import {
  getAllMemories, memoryCount, getTempMemory,
  getRecentSearches, getBehaviorPatterns,
  type Memory, type TempEntry, type BehaviorPattern,
} from "../lib/memory";
import type { ActionLogEntry, PlanStep } from "../store/novaStore";

interface NovaChatInterfaceProps {
  isHoldingSpace: boolean;
  voiceSupported: boolean | null;
  ollamaConnected: boolean | null;
  onSubmitText: (text: string) => void;
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

function PlanStepRow({ step }: { step: PlanStep }) {
  const icon =
    step.status === "done"    ? "✓" :
    step.status === "error"   ? "✗" :
    step.status === "active"  ? "●" : "○";

  const color =
    step.status === "done"   ? "text-green-500" :
    step.status === "error"  ? "text-red-500" :
    step.status === "active" ? "text-blue-500 animate-pulse" :
    "text-black/30 dark:text-white/25";

  return (
    <div className={`flex items-start gap-2.5 py-2 border-b border-black/8 dark:border-white/8 last:border-0 transition-all duration-300 ${step.status === "active" ? "opacity-100" : step.status === "pending" ? "opacity-50" : "opacity-90"}`}>
      <span className={`text-[14px] font-bold mt-0.5 shrink-0 ${color}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-black dark:text-[#e8e8e8] font-medium">{step.label}</div>
        {step.detail && (
          <div className="text-[10px] text-black/45 dark:text-white/35 mt-0.5 truncate">{step.detail}</div>
        )}
      </div>
    </div>
  );
}

function PlanOverlay() {
  const { activePlan } = useNovaStore();
  if (!activePlan) return null;

  const doneCount = activePlan.steps.filter((s) => s.status === "done").length;
  const total = activePlan.steps.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 rounded-[20px] backdrop-blur-sm">
      <div className="w-full max-w-sm mx-6 rounded-[20px] border-2 border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1a1a1a] shadow-[0_12px_0_#000] dark:shadow-[0_12px_0_#2a2a2a] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-black/15 dark:border-white/10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] tracking-[0.3em] uppercase text-black/40 dark:text-white/30">Research Plan</span>
            <span className="ml-auto text-[9px] tracking-wide text-black/40 dark:text-white/30 tabular-nums">{doneCount}/{total}</span>
          </div>
          <div className="text-[14px] font-bold text-black dark:text-[#e8e8e8] tracking-wide">{activePlan.title}</div>
          {/* Progress bar */}
          <div className="mt-3 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-black dark:bg-white transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {/* Steps */}
        <div className="px-5 py-3">
          {activePlan.steps.map((step) => (
            <PlanStepRow key={step.id} step={step} />
          ))}
        </div>
        {doneCount === total && (
          <div className="px-5 pb-4 text-[11px] tracking-[0.15em] uppercase text-green-600 dark:text-green-400 font-bold">
            ✓ All sources opened — check your browser
          </div>
        )}
      </div>
    </div>
  );
}

export function NovaChatInterface({
  isHoldingSpace,
  voiceSupported,
  ollamaConnected,
  onSubmitText,
  onClearChat,
  onResetSetup,
}: NovaChatInterfaceProps) {
  const {
    status, transcript, messages, errorMessage,
    providerConfig, theme, toggleTheme,
    actionLog, sessionStart, activePlan,
  } = useNovaStore();

  const isWaveformActive = status === "listening" || status === "speaking";
  const isBusy = status === "listening" || status === "processing" || status === "speaking";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");

  // Memory state
  const [universalMems, setUniversalMems] = useState<Memory[]>([]);
  const [tempEntries, setTempEntries] = useState<TempEntry[]>([]);
  const [recentSearches, setRecentSearches] = useState<TempEntry[]>([]);
  const [behaviors, setBehaviors] = useState<BehaviorPattern[]>([]);
  const [totalMems, setTotalMems] = useState(0);

  // Active memory tab
  const [memTab, setMemTab] = useState<"universal" | "session" | "learned">("session");

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

  function handleSend() {
    const text = inputText.trim();
    if (!text || isBusy) return;
    onSubmitText(text);
    setInputText("");
  }

  const cfg = providerConfig;
  const isDark = theme === "dark";

  const providerName =
    cfg.provider === "ollama"
      ? `OLLAMA / ${cfg.ollamaModel.toUpperCase()}`
      : cfg.provider === "anthropic"
      ? "ANTHROPIC / CLAUDE"
      : "OPENAI / GPT-4O";

  const connDot = () => {
    if (cfg.provider === "ollama") {
      if (ollamaConnected === null)
        return <span className="w-2 h-2 rounded-full bg-black/30 dark:bg-white/20 animate-pulse shrink-0" />;
      return <span className={`w-2 h-2 rounded-full shrink-0 ${ollamaConnected ? "bg-green-500" : "bg-red-500"}`} />;
    }
    const hasKey = cfg.apiKey.length > 0;
    return <span className={`w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-green-500" : "bg-red-500"}`} />;
  };

  const connLabel =
    cfg.provider === "ollama"
      ? ollamaConnected === null ? "CHECKING…" : ollamaConnected ? "CONNECTED" : "UNREACHABLE"
      : cfg.apiKey.length > 0 ? "KEY SET" : "KEY MISSING";

  const micLabel =
    isHoldingSpace ? "Listening…"
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

  return (
    <div className="h-screen bg-[#d8d8d8] dark:bg-[#0f0f0f] p-4 sm:p-6 font-mono flex flex-col transition-colors duration-200 overflow-hidden">
      <div className="flex-1 w-full rounded-[28px] border-2 border-black dark:border-[#3a3a3a] bg-[#dfdfdf] dark:bg-[#171717] shadow-[0_10px_0_#000] dark:shadow-[0_10px_0_#2a2a2a] p-2 flex flex-col min-h-0">
        <div className="relative flex-1 rounded-[20px] border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] p-3 sm:p-4 flex flex-col gap-3 min-h-0">

          {/* Plan overlay */}
          <PlanOverlay />

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

            <div className="flex items-center gap-2">
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

          {/* Main grid */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_310px] gap-3 flex-1 min-h-0">

            {/* Left: chat */}
            <div className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-3 flex flex-col min-h-0">
              <div className="text-[12px] tracking-[0.35em] uppercase text-black/75 dark:text-white/60 mb-3 shrink-0">Chat</div>

              {/* Waveform strip */}
              <div className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#e6e6e6] dark:bg-[#222] px-4 py-3 shadow-[0_6px_0_#000] dark:shadow-[0_6px_0_#2a2a2a] shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-black/60 dark:text-white/50">Live Session</span>
                  <span className="text-[10px] tracking-[0.2em] uppercase text-black/40 dark:text-white/35">
                    {voiceSupported ? "MIC READY" : "TEXT ONLY"}
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
                    {voiceSupported
                      ? 'Hold SPACE to talk — or type below. Try "get me articles about Iran US war"'
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
                    <span className={`w-1.5 h-1.5 rounded-full ${isBusy ? "bg-yellow-500 animate-pulse" : activePlan ? "bg-blue-500 animate-pulse" : "bg-green-500"}`} />
                    <span className="text-[9px] uppercase tracking-wide text-black/40 dark:text-white/30">
                      {activePlan ? "RESEARCHING" : isBusy ? status.toUpperCase() : "IDLE"}
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

              {/* Memory panel with tabs */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45">Memory</h3>
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

                  {/* Session (temp) tab */}
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

                  {/* Universal (permanent) tab */}
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

                  {/* Auto-learned behavioral patterns */}
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
                            {/* Interest strength bar */}
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
            <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2 flex items-center gap-3">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                placeholder={
                  isHoldingSpace ? "Listening… release Space when done"
                  : isBusy ? "Processing…"
                  : activePlan ? "Researching — please wait…"
                  : 'Ask anything or say "get me articles about…"'
                }
                disabled={isBusy || !!activePlan}
                className="flex-1 bg-transparent text-[12px] text-black dark:text-[#e8e8e8] placeholder-black/35 dark:placeholder-white/25 outline-none tracking-wide disabled:opacity-50"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim() || isBusy || !!activePlan}
                className="shrink-0 px-5 py-2 rounded-[12px] border border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-[12px] tracking-[0.2em] uppercase text-white dark:text-black transition-opacity disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-80"
              >
                Send
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
