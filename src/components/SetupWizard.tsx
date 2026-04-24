import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNovaStore } from "../store/novaStore";
import type { AIProvider } from "../store/novaStore";
import { fetchOllamaModels, checkCLI } from "../lib/providerClient";
import { invoke } from "@tauri-apps/api/core";

// ── Provider registry ─────────────────────────────────────────────────────────

interface ProviderOption {
  id: AIProvider;
  name: string;
  tag: string;
  description: string;
  category: "key" | "cli" | "local";
  cliName?: "claude" | "codex";
  installCmd?: string;
  authCmd?: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    tag: "API Key",
    category: "key",
    description: "Paste your Anthropic API key.",
  },
  {
    id: "openai",
    name: "OpenAI",
    tag: "API Key",
    category: "key",
    description: "Paste your OpenAI API key.",
  },
  {
    id: "claude_cli",
    name: "Claude Code CLI",
    tag: "Via CLI",
    category: "cli",
    description: "Re-use your existing Claude Code CLI session.",
    cliName: "claude",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    authCmd: "claude",
  },
  {
    id: "codex_cli",
    name: "OpenAI Codex CLI",
    tag: "Via CLI",
    category: "cli",
    description: "Re-use your existing Codex CLI session.",
    cliName: "codex",
    installCmd: "npm install -g @openai/codex",
    authCmd: "codex",
  },
  {
    id: "ollama",
    name: "Ollama",
    tag: "Free / Local",
    category: "local",
    description: "Runs on your machine. No account, no cost, no internet.",
  },
];

const CAT_LABEL: Record<ProviderOption["category"], string> = {
  key: "Use API key",
  cli:   "Re-use CLI session",
  local: "Free / local",
};

// ── API key panel ─────────────────────────────────────────────────────────────

function APIKeyPanel({ provider, onSave }: { provider: ProviderOption; onSave: (token: string) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  const label = provider.id === "anthropic" ? "Anthropic" : "OpenAI";
  const placeholder = provider.id === "anthropic" ? "sk-ant-..." : "sk-...";

  function handleSave() {
    const token = apiKey.trim();
    if (!token) {
      setError("Please enter your API key.");
      return;
    }
    setError("");
    onSave(token);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-4 py-4">
        <div className="text-[9px] tracking-[0.3em] uppercase text-black/40 dark:text-white/30 mb-2">
          {label} API Key
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-[13px] text-black dark:text-[#e8e8e8] placeholder-black/30 dark:placeholder-white/25 outline-none tracking-wide"
        />
        <div className="mt-3 text-[10px] text-black/45 dark:text-white/35 leading-relaxed">
          OAuth is temporarily disabled because provider callbacks are rejecting third-party app IDs.
          Use API key or CLI login for stable setup.
        </div>
      </div>

      {error && (
        <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-[11px] text-red-700 dark:text-red-300 tracking-wide">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        className="w-full rounded-[14px] border border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-white dark:text-black py-3 text-[11px] tracking-[0.2em] uppercase font-bold hover:opacity-80 transition-all"
      >
        Save and Start →
      </button>
    </div>
  );
}

// ── CLI panel ─────────────────────────────────────────────────────────────────

type CLIStatus  = "checking" | "found" | "missing";
type TestStatus = "idle" | "running" | "ok" | "fail";

function CLIPanel({ provider, onSave }: { provider: ProviderOption; onSave: () => void }) {
  const [cliStatus,  setCLIStatus]  = useState<CLIStatus>("checking");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState("");

  useEffect(() => {
    if (!provider.cliName) return;
    checkCLI(provider.cliName).then((found) => setCLIStatus(found ? "found" : "missing"));
  }, [provider.cliName]);

  async function handleTest() {
    if (!provider.cliName) return;
    setTestStatus("running");
    setTestResult("");
    try {
      const res = await invoke<string>("ask_via_cli", {
        cli: provider.cliName,
        prompt: "Reply with exactly five words describing yourself.",
      });
      setTestStatus("ok");
      setTestResult(res.trim().slice(0, 200));
    } catch (err) {
      setTestStatus("fail");
      setTestResult(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      {/* Status card */}
      <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-4 py-4">
        <div className="flex items-center gap-2.5 mb-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            cliStatus === "checking" ? "bg-black/25 dark:bg-white/20 animate-pulse"
            : cliStatus === "found"  ? "bg-green-500"
            : "bg-red-500"
          }`} />
          <span className="text-[11px] tracking-[0.2em] uppercase font-bold text-black dark:text-[#e8e8e8]">
            {cliStatus === "checking" ? "Detecting…"
              : cliStatus === "found" ? `${provider.cliName} — found`
              : `${provider.cliName} — not found`}
          </span>
        </div>

        {cliStatus === "missing" && (
          <div className="space-y-3 pt-3 border-t border-black/10 dark:border-white/10">
            <div>
              <div className="text-[9px] tracking-widest uppercase text-black/35 dark:text-white/25 mb-1.5">1 — Install</div>
              <div className="rounded-[10px] border border-black/15 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-mono text-[11px] text-black/70 dark:text-white/60 select-all">
                {provider.installCmd}
              </div>
            </div>
            <div>
              <div className="text-[9px] tracking-widest uppercase text-black/35 dark:text-white/25 mb-1.5">2 — Authenticate (opens browser)</div>
              <div className="rounded-[10px] border border-black/15 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-mono text-[11px] text-black/70 dark:text-white/60 select-all">
                {provider.authCmd}
              </div>
            </div>
            <div className="text-[10px] text-black/40 dark:text-white/30">Then restart Cortex Nova — it will detect the CLI automatically.</div>
          </div>
        )}

        {cliStatus === "found" && (
          <div className="text-[11px] text-black/50 dark:text-white/40 leading-relaxed">
            Nova will reuse your existing <span className="font-mono bg-black/8 dark:bg-white/8 px-1.5 py-0.5 rounded-[6px]">{provider.authCmd}</span> session.
            Re-run it in a terminal to re-authenticate if needed.
          </div>
        )}
      </div>

      {/* Test button */}
      <button
        onClick={handleTest}
        disabled={cliStatus !== "found" || testStatus === "running"}
        className="w-full rounded-[14px] border border-black/25 dark:border-white/15 py-2.5 text-[10px] tracking-widest uppercase text-black/55 dark:text-white/45 hover:border-black dark:hover:border-white/40 hover:text-black dark:hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {testStatus === "running" ? "Testing…" : "Test Connection"}
      </button>

      {testStatus !== "idle" && testStatus !== "running" && (
        <div className={`rounded-[14px] border px-4 py-3 ${
          testStatus === "ok"
            ? "border-green-600/40 bg-green-500/10"
            : "border-red-500/40 bg-red-500/10"
        }`}>
          <div className={`text-[9px] tracking-widest uppercase font-bold mb-1.5 ${
            testStatus === "ok" ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
          }`}>
            {testStatus === "ok" ? "✓ Connected" : "✗ Failed"}
          </div>
          <div className={`text-[11px] font-mono break-all leading-relaxed ${
            testStatus === "ok" ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"
          }`}>{testResult}</div>
        </div>
      )}

      <button
        onClick={onSave}
        disabled={cliStatus === "missing"}
        className="w-full rounded-[14px] border border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-white dark:text-black py-3 text-[11px] tracking-[0.2em] uppercase font-bold hover:opacity-80 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
      >
        Save and Start →
      </button>
    </div>
  );
}

// ── Ollama panel ──────────────────────────────────────────────────────────────

function OllamaPanel({ onSave }: { onSave: (model: string, url: string) => void }) {
  const [url, setUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchOllamaModels(url).then((models) => {
      setInstalled(models);
      if (models.length > 0 && !model) setModel(models[0]);
      setLoading(false);
    });
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    setError("");
    const finalModel = custom.trim() || model;
    if (!finalModel) { setError("Pick or enter a model name."); return; }
    onSave(finalModel, url.trim() || "http://localhost:11434");
  }

  return (
    <div className="space-y-3">
      {/* URL field */}
      <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-4 py-3">
        <div className="text-[9px] tracking-widest uppercase text-black/40 dark:text-white/30 mb-2">Ollama URL</div>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:11434"
          className="w-full bg-transparent text-[13px] text-black dark:text-[#e8e8e8] placeholder-black/30 dark:placeholder-white/25 outline-none tracking-wide"
        />
      </div>

      {/* Model picker */}
      <div className="rounded-[14px] border border-black dark:border-[#3a3a3a] bg-[#ececec] dark:bg-[#242424] px-4 py-3">
        <div className="text-[9px] tracking-widest uppercase text-black/40 dark:text-white/30 mb-3">
          {loading ? "Model — detecting…" : `Model — ${installed.length} installed`}
        </div>

        {installed.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {installed.map((m) => (
              <button
                key={m}
                onClick={() => { setModel(m); setCustom(""); }}
                className={`text-[10px] tracking-wide px-3 py-1.5 rounded-full border transition-all ${
                  model === m && !custom
                    ? "border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-white dark:text-black"
                    : "border-black/30 dark:border-white/20 text-black/60 dark:text-white/50 hover:border-black dark:hover:border-white/50"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={installed.length > 0 ? "or type a custom model…" : "model name (e.g. qwen2.5:1.5b)"}
          className="w-full bg-transparent text-[12px] text-black dark:text-[#e8e8e8] placeholder-black/30 dark:placeholder-white/25 outline-none border-b border-black/15 dark:border-white/10 pb-1.5 tracking-wide"
        />

        {custom && (
          <div className="mt-3 text-[10px] text-black/45 dark:text-white/35">
            Make sure it&apos;s pulled: <span className="font-mono font-bold text-black dark:text-[#e8e8e8]">ollama pull {custom}</span>
          </div>
        )}

        {installed.length === 0 && !loading && (
          <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10 text-[10px] text-black/45 dark:text-white/35 space-y-1">
            <div>No models found — pull one first:</div>
            <div className="font-mono font-bold text-black dark:text-[#e8e8e8]">ollama pull qwen2.5:1.5b</div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-[11px] text-red-600 dark:text-red-400 tracking-wide">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        className="w-full rounded-[14px] border border-black dark:border-[#e8e8e8] bg-black dark:bg-[#e8e8e8] text-white dark:text-black py-3 text-[11px] tracking-[0.2em] uppercase font-bold hover:opacity-80 transition-all"
      >
        Save and Start →
      </button>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function SetupWizard() {
  const { saveProviderConfig, theme } = useNovaStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selected, setSelected] = useState<AIProvider | null>(null);

  const provider = PROVIDERS.find((p) => p.id === selected);

  function handleSelect(id: AIProvider) {
    setSelected(id);
    setStep("configure");
  }

  function handleBack() {
    setStep("pick");
    setSelected(null);
  }

  function saveOAuth(token: string) {
    if (!selected) return;
    saveProviderConfig({ provider: selected, apiKey: token, ollamaModel: "", ollamaUrl: "" });
  }

  function saveCLI() {
    if (!selected) return;
    saveProviderConfig({ provider: selected, apiKey: "", ollamaModel: "", ollamaUrl: "" });
  }

  function saveOllama(model: string, url: string) {
    saveProviderConfig({ provider: "ollama", apiKey: "", ollamaModel: model, ollamaUrl: url });
  }

  return (
    <div className="h-screen bg-[#d8d8d8] dark:bg-[#0f0f0f] p-4 sm:p-6 font-mono flex flex-col transition-colors duration-200 overflow-hidden">
      <div className="flex-1 w-full rounded-[28px] border-2 border-black dark:border-[#3a3a3a] bg-[#dfdfdf] dark:bg-[#171717] shadow-[0_10px_0_#000] dark:shadow-[0_10px_0_#2a2a2a] p-2 flex flex-col min-h-0">
        <div className="flex-1 rounded-[20px] border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] p-3 sm:p-4 flex flex-col gap-3 min-h-0">

          {/* Header */}
          <div className="rounded-[16px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] px-4 py-3 flex items-center justify-between shrink-0">
            <span className="text-[12px] tracking-[0.35em] uppercase text-black dark:text-[#e8e8e8] font-bold">CORTEX NOVA</span>
            <span className="px-3 py-1 text-[10px] tracking-[0.2em] uppercase border border-black dark:border-[#3a3a3a] rounded-full text-black/60 dark:text-white/50">
              Setup
            </span>
          </div>

          {/* Content panel */}
          <div className="flex-1 rounded-[18px] border border-black dark:border-[#3a3a3a] bg-[#dddddd] dark:bg-[#1a1a1a] p-4 overflow-y-auto min-h-0">
            <AnimatePresence mode="wait">

              {/* ── Pick ── */}
              {step === "pick" && (
                <motion.div
                  key="pick"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="text-[9px] tracking-[0.35em] uppercase text-black/40 dark:text-white/30 mb-4">
                    Choose how to connect
                  </div>

                  {(["key", "cli", "local"] as const).map((cat) => {
                    const group = PROVIDERS.filter((p) => p.category === cat);
                    return (
                      <div key={cat} className="mb-4">
                        <div className="text-[8px] tracking-[0.4em] uppercase text-black/25 dark:text-white/20 mb-2 px-1">
                          {CAT_LABEL[cat]}
                        </div>
                        <div className="rounded-[16px] border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] overflow-hidden">
                          {group.map((p, i) => (
                            <button
                              key={p.id}
                              onClick={() => handleSelect(p.id)}
                              className={`w-full text-left px-4 py-3.5 hover:bg-[#f0f0f0] dark:hover:bg-[#2a2a2a] transition-colors group flex items-center justify-between gap-3 ${
                                i < group.length - 1 ? "border-b border-black/10 dark:border-white/8" : ""
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-bold tracking-wide text-black dark:text-[#e8e8e8] mb-0.5">
                                  {p.name}
                                </div>
                                <div className="text-[11px] text-black/45 dark:text-white/35 leading-snug">{p.description}</div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] tracking-widest uppercase px-2.5 py-1 rounded-full border border-black/20 dark:border-white/15 text-black/50 dark:text-white/40">
                                  {p.tag}
                                </span>
                                <span className="text-black/25 dark:text-white/20 group-hover:text-black/60 dark:group-hover:text-white/50 transition-colors text-sm">→</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}

              {/* ── Configure ── */}
              {step === "configure" && provider && (
                <motion.div
                  key="configure"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={handleBack}
                      className="text-[10px] tracking-[0.2em] uppercase text-black/40 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors px-2.5 py-1 rounded-full border border-black/15 dark:border-white/10 hover:border-black/40 dark:hover:border-white/30"
                    >
                      ← Back
                    </button>
                    <span className="text-black/20 dark:text-white/15">/</span>
                    <span className="text-[11px] tracking-[0.2em] uppercase font-bold text-black dark:text-[#e8e8e8]">
                      {provider.name}
                    </span>
                    <span className="ml-auto text-[9px] tracking-widest uppercase px-2.5 py-1 rounded-full border border-black/20 dark:border-white/15 text-black/45 dark:text-white/35">
                      {provider.tag}
                    </span>
                  </div>

                  {provider.category === "key" && (
                    <APIKeyPanel provider={provider} onSave={saveOAuth} />
                  )}
                  {provider.category === "cli" && (
                    <CLIPanel provider={provider} onSave={saveCLI} />
                  )}
                  {selected === "ollama" && (
                    <OllamaPanel onSave={saveOllama} />
                  )}
                </motion.div>
              )}

            </AnimatePresence>
          </div>

        </div>
      </div>
    </div>
  );
}
