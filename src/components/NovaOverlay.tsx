import { useEffect, useRef, useState } from "react";
import { useNovaStore } from "../store/novaStore";
import { WaveformAnimation } from "./WaveformAnimation";
import { StatusIndicator } from "./StatusIndicator";
import { getAllMemories, memoryCount, type Memory } from "../lib/memory";

interface NovaChatInterfaceProps {
  isHoldingSpace: boolean;
  voiceSupported: boolean | null;
  ollamaConnected: boolean | null;
  onSubmitText: (text: string) => void;
  onClearChat: () => void;
  onResetSetup: () => void;
}

const QUICK_COMMANDS = [
  { label: "Open YouTube",     cmd: "open youtube" },
  { label: "Search news",      cmd: "search for latest news" },
  { label: "Open GitHub",      cmd: "open github" },
  { label: "What is AI?",      cmd: "what is artificial intelligence?" },
  { label: "Open Gmail",       cmd: "open gmail" },
  { label: "Explain async",    cmd: "explain async await in javascript" },
];

const CAPABILITY_CARDS = [
  "Routes spoken or typed commands to real OS actions.",
  "Falls back to AI for anything it can't route locally.",
  "Hold SPACE to talk — release when you're done speaking.",
];

export function NovaChatInterface({
  isHoldingSpace,
  voiceSupported,
  ollamaConnected,
  onSubmitText,
  onClearChat,
  onResetSetup,
}: NovaChatInterfaceProps) {
  const { status, transcript, messages, errorMessage, providerConfig, theme, toggleTheme } = useNovaStore();
  const isWaveformActive = status === "listening" || status === "speaking";
  const isBusy = status === "listening" || status === "processing" || status === "speaking";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [recentMemories, setRecentMemories] = useState<Memory[]>([]);
  const [totalMemories, setTotalMemories] = useState(0);

  // Refresh memory panel whenever messages change (commands may have stored new memories)
  useEffect(() => {
    setRecentMemories(getAllMemories().slice(0, 4));
    setTotalMemories(memoryCount());
  }, [messages]);

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

  return (
    <div className="min-h-screen bg-[#d8d8d8] dark:bg-[#0f0f0f] p-4 sm:p-6 font-mono flex flex-col transition-colors duration-200">
      <div className="flex-1 w-full max-w-[1140px] mx-auto rounded-[28px] border-2 border-black dark:border-[#3a3a3a] bg-[#dfdfdf] dark:bg-[#171717] shadow-[0_10px_0_#000] dark:shadow-[0_10px_0_#2a2a2a] p-2 flex flex-col min-h-0">
        <div className="flex-1 rounded-[20px] border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] p-3 sm:p-4 flex flex-col gap-3 min-h-0">

          {/* Header */}
          <div className="rounded-[16px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] px-4 py-3 flex items-center justify-between gap-3 shrink-0 flex-wrap gap-y-2">
            <div className="flex items-center gap-3">
              <span className="text-[12px] tracking-[0.35em] uppercase text-black dark:text-[#e8e8e8] font-bold">CORTEX NOVA</span>
              <span className="px-3 py-1 text-[10px] tracking-[0.2em] uppercase border border-black dark:border-[#3a3a3a] rounded-full text-black/70 dark:text-white/60">
                Voice Assistant
              </span>
            </div>

            {/* Provider + connection */}
            <div className="flex items-center gap-2 px-3 py-1.5 border border-black dark:border-[#3a3a3a] rounded-full bg-[#ececec] dark:bg-[#242424]">
              {connDot()}
              <span className="text-[10px] tracking-[0.2em] uppercase text-black/70 dark:text-white/60">{providerName}</span>
              <span className="text-[10px] tracking-[0.15em] uppercase text-black/35 dark:text-white/30">— {connLabel}</span>
            </div>

            <div className="flex items-center gap-2">
              <StatusIndicator status={status} />
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="text-[10px] tracking-[0.2em] uppercase px-3 py-1 border border-black/30 dark:border-[#3a3a3a] rounded-full hover:border-black dark:hover:border-white/50 transition-colors text-black/60 dark:text-white/50"
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
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
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3 flex-1 min-h-0">

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
                    {voiceSupported ? "Hold SPACE to talk — or type below." : "Type a message below to get started."}
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
                    <div className="text-[10px] tracking-[0.2em] uppercase text-black/45 dark:text-white/35 mb-1">
                      {msg.role === "user" ? "You" : "Nova"}
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
            <aside className="rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-4 flex flex-col gap-4 overflow-y-auto">

              {/* Quick commands */}
              <div>
                <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45 mb-2">Quick Commands</h3>
                <div className="flex flex-wrap gap-2">
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

              {/* Memory panel */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45">Memory</h3>
                  <span className="text-[10px] tracking-[0.15em] uppercase text-black/35 dark:text-white/25">{totalMemories} stored</span>
                </div>
                {recentMemories.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-black/25 dark:border-white/15 px-3 py-2 text-[11px] text-black/35 dark:text-white/25">
                    Say "remember that…" to store a fact
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {recentMemories.map((m) => (
                      <div key={m.id} className="rounded-[12px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-2.5 py-2">
                        <div className="text-[10px] tracking-[0.15em] uppercase text-black/35 dark:text-white/25 mb-0.5">
                          {new Date(m.ts).toLocaleDateString()}
                        </div>
                        <div className="text-[11px] text-black/75 dark:text-white/60 leading-snug line-clamp-2">{m.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Capabilities */}
              <div>
                <h3 className="text-[11px] tracking-[0.32em] uppercase text-black/60 dark:text-white/45 mb-2">What Nova Does</h3>
                <div className="space-y-2">
                  {CAPABILITY_CARDS.map((card) => (
                    <div key={card} className="rounded-[12px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-2.5 text-[11px] leading-relaxed text-black/75 dark:text-white/60">
                      {card}
                    </div>
                  ))}
                </div>
              </div>

              {/* Session stats */}
              <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-3">
                <div className="text-[10px] tracking-[0.25em] uppercase text-black/45 dark:text-white/35 mb-2">Session</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[20px] font-bold text-black dark:text-[#e8e8e8] leading-none">{messages.length}</div>
                    <div className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/30 mt-0.5">msgs</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-bold text-black dark:text-[#e8e8e8] leading-none">
                      {messages.filter((m) => m.role === "user").length}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/30 mt-0.5">queries</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-bold text-black dark:text-[#e8e8e8] leading-none">{totalMemories}</div>
                    <div className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/30 mt-0.5">memories</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isBusy ? "bg-yellow-500 animate-pulse" : "bg-green-500"}`} />
                  <span className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/30">
                    {isBusy ? status.toUpperCase() : "IDLE"}
                  </span>
                </div>
              </div>

              {/* Connection detail */}
              <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-3 py-3 mt-auto">
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
                  isHoldingSpace
                    ? "Listening… release Space when done"
                    : isBusy
                    ? "Processing…"
                    : "Ask something or give a command…"
                }
                disabled={isBusy}
                className="flex-1 bg-transparent text-[12px] text-black dark:text-[#e8e8e8] placeholder-black/35 dark:placeholder-white/25 outline-none tracking-wide disabled:opacity-50"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim() || isBusy}
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
