import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NovaStatus = "idle" | "listening" | "processing" | "speaking" | "error";
export type AIProvider = "anthropic" | "openai" | "ollama" | "claude_cli" | "codex_cli";

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  latencyMs?: number;
}

export interface ActionLogEntry {
  id: string;
  ts: number;
  type: "os" | "ai" | "memory" | "research";
  label: string;
  latencyMs?: number;
}

export type PlanStepStatus = "pending" | "active" | "done" | "error";

export interface PlanStep {
  id: string;
  label: string;
  detail?: string;
  status: PlanStepStatus;
}

export interface ActivePlan {
  title: string;
  topic: string;
  steps: PlanStep[];
}

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  ollamaModel: string;
  ollamaUrl: string;
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "ollama",
  apiKey: "",
  ollamaModel: "llama3.2",
  ollamaUrl: "http://localhost:11434",
};

const ACTION_LOG_LIMIT = 20;

interface NovaState {
  status: NovaStatus;
  transcript: string;
  response: string;
  isOverlayVisible: boolean;
  errorMessage: string | null;
  messages: ChatMessage[];
  actionLog: ActionLogEntry[];
  sessionStart: number;
  activePlan: ActivePlan | null;

  providerConfig: ProviderConfig;
  isSetupComplete: boolean;
  theme: "light" | "dark";

  setStatus: (status: NovaStatus) => void;
  setTranscript: (transcript: string) => void;
  setResponse: (response: string) => void;
  showOverlay: () => void;
  hideOverlay: () => void;
  setError: (msg: string | null) => void;
  reset: () => void;
  addMessage: (msg: Omit<ChatMessage, "id">) => void;
  clearMessages: () => void;
  addActionLog: (entry: Omit<ActionLogEntry, "id">) => void;
  setPlan: (plan: ActivePlan | null) => void;
  updatePlanStep: (stepId: string, status: PlanStepStatus, detail?: string) => void;
  clearPlan: () => void;
  saveProviderConfig: (config: ProviderConfig) => void;
  resetSetup: () => void;
  toggleTheme: () => void;
}

export const useNovaStore = create<NovaState>()(
  persist(
    (set) => ({
      status: "idle",
      transcript: "",
      response: "",
      isOverlayVisible: false,
      errorMessage: null,
      messages: [],
      actionLog: [],
      sessionStart: Date.now(),
      activePlan: null,

      providerConfig: DEFAULT_PROVIDER_CONFIG,
      isSetupComplete: false,
      theme: "light",

      setStatus: (status) => set({ status }),
      setTranscript: (transcript) => set({ transcript }),
      setResponse: (response) => set({ response }),
      showOverlay: () => set({ isOverlayVisible: true }),
      hideOverlay: () => set({ isOverlayVisible: false, status: "idle", transcript: "", response: "", messages: [] }),
      setError: (errorMessage) => set({ errorMessage, status: "error" }),
      reset: () => set({ status: "idle", transcript: "", response: "", errorMessage: null }),
      addMessage: (msg) =>
        set((s) => ({ messages: [...s.messages, { ...msg, id: crypto.randomUUID() }] })),
      clearMessages: () => set({ messages: [], actionLog: [], sessionStart: Date.now(), activePlan: null }),
      addActionLog: (entry) =>
        set((s) => ({
          actionLog: [{ ...entry, id: crypto.randomUUID() }, ...s.actionLog].slice(0, ACTION_LOG_LIMIT),
        })),
      setPlan: (activePlan) => set({ activePlan }),
      updatePlanStep: (stepId, status, detail) =>
        set((s) => {
          if (!s.activePlan) return {};
          return {
            activePlan: {
              ...s.activePlan,
              steps: s.activePlan.steps.map((step) =>
                step.id === stepId ? { ...step, status, ...(detail ? { detail } : {}) } : step
              ),
            },
          };
        }),
      clearPlan: () => set({ activePlan: null }),
      saveProviderConfig: (config) => set({ providerConfig: config, isSetupComplete: true }),
      resetSetup: () => set({ isSetupComplete: false, providerConfig: DEFAULT_PROVIDER_CONFIG }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
    }),
    {
      name: "nova-config",
      partialize: (state) => ({
        providerConfig: state.providerConfig,
        isSetupComplete: state.isSetupComplete,
        theme: state.theme,
      }),
    }
  )
);
