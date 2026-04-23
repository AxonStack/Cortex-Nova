import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNovaStore } from "../store/novaStore";
import type { AIProvider, ProviderConfig } from "../store/novaStore";
import { fetchOllamaModels } from "../lib/providerClient";

interface ProviderOption {
  id: AIProvider;
  name: string;
  description: string;
  requiresKey: boolean;
  keyPlaceholder?: string;
  tag: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: "ollama",    name: "OLLAMA",    tag: "FREE / LOCAL",       requiresKey: false, description: "Runs on your machine. No API key, no cost, no internet." },
  { id: "anthropic", name: "ANTHROPIC", tag: "REQUIRES API KEY",   requiresKey: true,  keyPlaceholder: "sk-ant-...", description: "Claude claude-sonnet-4-6. Strong reasoning." },
  { id: "openai",    name: "OPENAI",    tag: "REQUIRES API KEY",   requiresKey: true,  keyPlaceholder: "sk-...", description: "GPT-4o. Fast and reliable." },
];

export function SetupWizard() {
  const { saveProviderConfig } = useNovaStore();

  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selected, setSelected] = useState<AIProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("");
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [error, setError] = useState("");

  const provider = PROVIDERS.find((p) => p.id === selected);

  useEffect(() => {
    if (selected !== "ollama") return;
    setModelsLoading(true);
    fetchOllamaModels(ollamaUrl).then((models) => {
      setInstalledModels(models);
      if (models.length > 0 && !ollamaModel) setOllamaModel(models[0]);
      setModelsLoading(false);
    });
  }, [selected, ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(id: AIProvider) {
    setSelected(id);
    setError("");
    setStep("configure");
  }

  function handleBack() {
    setStep("pick");
    setError("");
    setInstalledModels([]);
    setOllamaModel("");
    setCustomModel("");
  }

  function handleSave() {
    setError("");
    if (!selected) return;
    if ((selected === "anthropic" || selected === "openai") && !apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    const finalModel = selected === "ollama" ? (customModel.trim() || ollamaModel) : "";
    if (selected === "ollama" && !finalModel) {
      setError("Select or enter a model name.");
      return;
    }
    const config: ProviderConfig = {
      provider: selected,
      apiKey: apiKey.trim(),
      ollamaModel: finalModel,
      ollamaUrl: ollamaUrl.trim() || "http://localhost:11434",
    };
    saveProviderConfig(config);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center px-5 py-3 border-b border-black bg-white/60">
        <span className="text-xs tracking-widest font-bold uppercase">CORTEX NOVA / SETUP</span>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            {step === "pick" && (
              <motion.div
                key="pick"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <div className="text-[9px] tracking-widest uppercase text-black/40 mb-5">
                  SELECT AI PROVIDER
                </div>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p.id)}
                    className="w-full text-left border border-black/20 hover:border-black bg-white/40 hover:bg-white/80 transition-all p-4 group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold tracking-wide">{p.name}</span>
                      <span className="text-[9px] tracking-widest uppercase text-black/40 group-hover:text-black/60">
                        {p.tag}
                      </span>
                    </div>
                    <div className="text-xs text-black/50">{p.description}</div>
                    <div className="text-[9px] tracking-widest text-black/30 mt-2 group-hover:text-black/50">
                      SELECT →
                    </div>
                  </button>
                ))}
              </motion.div>
            )}

            {step === "configure" && provider && (
              <motion.div
                key="configure"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={handleBack} className="text-[9px] tracking-widest uppercase text-black/40 hover:text-black transition-colors">
                    ← BACK
                  </button>
                  <span className="text-[9px] tracking-widest uppercase text-black/30">/</span>
                  <span className="text-[9px] tracking-widest uppercase font-bold">{provider.name}</span>
                </div>

                {/* Ollama */}
                {selected === "ollama" && (
                  <>
                    <Field label="OLLAMA URL">
                      <input
                        type="text"
                        value={ollamaUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full bg-transparent border-b border-black/20 focus:border-black py-2 text-sm outline-none placeholder-black/25 uppercase tracking-wide transition-colors"
                      />
                    </Field>

                    <Field label={modelsLoading ? "MODEL  (LOADING...)" : `MODEL  — ${installedModels.length} INSTALLED`}>
                      {installedModels.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {installedModels.map((m) => (
                            <button
                              key={m}
                              onClick={() => { setOllamaModel(m); setCustomModel(""); }}
                              className={`text-[10px] tracking-wide border px-3 py-1.5 uppercase transition-all
                                ${ollamaModel === m && !customModel
                                  ? "border-black bg-black text-white"
                                  : "border-black/30 hover:border-black"}`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        placeholder={installedModels.length > 0 ? "OR TYPE A CUSTOM MODEL..." : "TYPE MODEL NAME (e.g. qwen2.5:1.5b)"}
                        className="w-full bg-transparent border-b border-black/20 focus:border-black py-2 text-sm outline-none placeholder-black/25 uppercase tracking-wide transition-colors"
                      />
                    </Field>

                    {customModel && (
                      <div className="border border-black/20 px-4 py-3 text-xs text-black/60">
                        ENSURE MODEL IS PULLED:{" "}
                        <span className="font-bold text-black">ollama pull {customModel}</span>
                      </div>
                    )}

                    {installedModels.length === 0 && !modelsLoading && (
                      <div className="border border-black/20 px-4 py-3 text-xs text-black/60 space-y-1">
                        <div>NO MODELS FOUND. PULL ONE FIRST:</div>
                        <div className="font-bold text-black">ollama pull qwen2.5:1.5b</div>
                      </div>
                    )}
                  </>
                )}

                {/* API key */}
                {(selected === "anthropic" || selected === "openai") && (
                  <>
                    <Field label="API KEY">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={provider.keyPlaceholder}
                        autoComplete="off"
                        className="w-full bg-transparent border-b border-black/20 focus:border-black py-2 text-sm outline-none placeholder-black/25 font-mono tracking-wide transition-colors"
                      />
                    </Field>
                    <div className="text-[9px] tracking-widest uppercase text-black/30">
                      {selected === "anthropic" && "GET KEY → CONSOLE.ANTHROPIC.COM"}
                      {selected === "openai" && "GET KEY → PLATFORM.OPENAI.COM"}
                    </div>
                  </>
                )}

                {error && (
                  <div className="border border-black text-xs px-4 py-2 tracking-wide uppercase">
                    ERROR: {error}
                  </div>
                )}

                <button
                  onClick={handleSave}
                  className="w-full border border-black py-3 text-[11px] tracking-widest uppercase font-bold hover:bg-black hover:text-white transition-all"
                >
                  SAVE AND START CORTEX NOVA →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] tracking-widest uppercase text-black/40 mb-2">{label}</div>
      {children}
    </div>
  );
}
