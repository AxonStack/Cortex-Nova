import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NovaStatus = "idle" | "listening" | "processing" | "speaking" | "error";
export type AIProvider = "anthropic" | "openai" | "ollama";

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
}

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;        // empty for ollama
  ollamaModel: string;   // e.g. "llama3.2"
  ollamaUrl: string;     // e.g. "http://localhost:11434"
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "ollama",
  apiKey: "",
  ollamaModel: "llama3.2",
  ollamaUrl: "http://localhost:11434",
};

interface NovaState {
  // Voice assistant state
  status: NovaStatus;
  transcript: string;
  response: string;
  isOverlayVisible: boolean;
  errorMessage: string | null;
  messages: ChatMessage[];

  // Provider config (persisted to localStorage)
  providerConfig: ProviderConfig;
  isSetupComplete: boolean;
  theme: "light" | "dark";

  // Actions
  setStatus: (status: NovaStatus) => void;
  setTranscript: (transcript: string) => void;
  setResponse: (response: string) => void;
  showOverlay: () => void;
  hideOverlay: () => void;
  setError: (msg: string | null) => void;
  reset: () => void;
  addMessage: (msg: Omit<ChatMessage, "id">) => void;
  clearMessages: () => void;
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
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, { ...msg, id: crypto.randomUUID() }] })),
      clearMessages: () => set({ messages: [] }),
      saveProviderConfig: (config) => set({ providerConfig: config, isSetupComplete: true }),
      resetSetup: () => set({ isSetupComplete: false, providerConfig: DEFAULT_PROVIDER_CONFIG }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
    }),
    {
      name: "nova-config",
      // Only persist config + theme — not runtime voice state
      partialize: (state) => ({
        providerConfig: state.providerConfig,
        isSetupComplete: state.isSetupComplete,
        theme: state.theme,
      }),
    }
  )
);
