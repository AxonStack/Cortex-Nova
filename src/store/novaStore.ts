import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApprovalPreview } from "../lib/appAdapters";

export interface ApprovalRequest {
  id: string;
  preview: ApprovalPreview;
}

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
  type: "research" | "youtube_play" | "desktop_task";
  steps: PlanStep[];
}

export type ReplayDesktopAction =
  | { id: string; kind: "desktop_open_app"; app: string; label: string }
  | { id: string; kind: "desktop_close_app"; app: string; label: string }
  | { id: string; kind: "browser_navigate"; url: string; label: string }
  | { id: string; kind: "desktop_focus_window"; name: string; label: string }
  | { id: string; kind: "desktop_press_key"; keys: string; label: string }
  | { id: string; kind: "desktop_type_text"; text: string; label: string }
  | { id: string; kind: "desktop_mouse_click"; x: number; y: number; label: string };

export interface ReplayResearchStep {
  id: string;
  label: string;
  detail: string;
  url: string;
  delayMs: number;
}

export type TaskReplayPayload =
  | { kind: "desktop_task"; actions: ReplayDesktopAction[] }
  | { kind: "youtube_play"; query: string }
  | { kind: "research"; steps: ReplayResearchStep[] };

export interface TaskReplayDraft {
  title: string;
  sourceCommand: string;
  payload: TaskReplayPayload;
}

export type TaskContextStatus = "running" | "completed" | "failed" | "interrupted";

export interface TaskContext {
  id: string;
  sourceCommand: string;
  title: string;
  topic: string;
  type: ActivePlan["type"];
  status: TaskContextStatus;
  startedAt: number;
  updatedAt: number;
  summary?: string;
  lastError?: string;
  completedSteps: number;
  totalSteps: number;
  planSnapshot: ActivePlan;
  replayPayload: TaskReplayPayload;
}

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  ollamaModel: string;
  ollamaUrl: string;
}

export interface AutomationPermissions {
  desktopAutomation: boolean;
  appControl: boolean;
  browserControl: boolean;
  keyboardMouseControl: boolean;
}

export interface AppPolicy {
  mode: "off" | "allowlist" | "denylist";
  entries: string[];
}

export interface BinaryBrainConfig {
  enabled: boolean;
}

export interface RecordedInputEvent {
  kind: "KeyPress" | "MouseClick";
  key?: string;
  x?: number;
  y?: number;
  button?: string;
  ts: number;
}

export interface LearnedMacro {
  id: string;
  name: string;
  createdAt: number;
  events: RecordedInputEvent[];
  command?: string;
  runs?: number;
  successes?: number;
  failures?: number;
  lastRunAt?: number;
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
  taskContext: TaskContext | null;

  providerConfig: ProviderConfig;
  permissions: AutomationPermissions;
  appPolicy: AppPolicy;
  binaryBrain: BinaryBrainConfig;
  isSetupComplete: boolean;
  theme: "light" | "dark";
  backgroundListening: boolean;

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
  beginTaskContext: (sourceCommand: string, plan: ActivePlan, replayPayload: TaskReplayPayload) => void;
  syncTaskPlan: (plan: ActivePlan) => void;
  finishTaskContext: (status: Extract<TaskContextStatus, "completed" | "failed" | "interrupted">, summary: string) => void;
  clearTaskContext: () => void;
  saveProviderConfig: (config: ProviderConfig) => void;
  setPermission: (key: keyof AutomationPermissions, value: boolean) => void;
  setAppPolicyMode: (mode: AppPolicy["mode"]) => void;
  setAppPolicyEntries: (entries: string[]) => void;
  setBinaryBrainEnabled: (enabled: boolean) => void;
  resetSetup: () => void;
  toggleTheme: () => void;
  setBackgroundListening: (enabled: boolean) => void;

  learnedMacros: LearnedMacro[];
  saveMacro: (macro: Omit<LearnedMacro, "id" | "createdAt">) => void;
  deleteMacro: (id: string) => void;
  markWorkflowRun: (id: string) => void;
  markWorkflowOutcome: (id: string, success: boolean) => void;

  pendingApproval: ApprovalRequest | null;
  setPendingApproval: (req: ApprovalRequest | null) => void;
}

const DEFAULT_PERMISSIONS: AutomationPermissions = {
  desktopAutomation: false,
  appControl: false,
  browserControl: false,
  keyboardMouseControl: false,
};
const DEFAULT_APP_POLICY: AppPolicy = { mode: "off", entries: [] };

function countDoneSteps(plan: ActivePlan): number {
  return plan.steps.filter((step) => step.status === "done").length;
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
      taskContext: null,

      providerConfig: DEFAULT_PROVIDER_CONFIG,
      permissions: DEFAULT_PERMISSIONS,
      appPolicy: DEFAULT_APP_POLICY,
      binaryBrain: { enabled: true },
      isSetupComplete: false,
      theme: "light",
      backgroundListening: false,
      learnedMacros: [],
      pendingApproval: null,

      setStatus: (status) => set({ status }),
      setTranscript: (transcript) => set({ transcript }),
      setResponse: (response) => set({ response }),
      showOverlay: () => set({ isOverlayVisible: true }),
      hideOverlay: () => set({ isOverlayVisible: false, status: "idle", transcript: "", response: "", messages: [] }),
      setError: (errorMessage) => set({ errorMessage, ...(errorMessage ? { status: "error" as const } : {}) }),
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
      beginTaskContext: (sourceCommand, plan, replayPayload) =>
        set({
          taskContext: {
            id: crypto.randomUUID(),
            sourceCommand: sourceCommand.trim(),
            title: plan.title,
            topic: plan.topic,
            type: plan.type,
            status: "running",
            startedAt: Date.now(),
            updatedAt: Date.now(),
            completedSteps: countDoneSteps(plan),
            totalSteps: plan.steps.length,
            planSnapshot: plan,
            replayPayload,
          },
        }),
      syncTaskPlan: (plan) =>
        set((s) => {
          if (!s.taskContext) return {};
          return {
            taskContext: {
              ...s.taskContext,
              title: plan.title,
              topic: plan.topic,
              type: plan.type,
              updatedAt: Date.now(),
              completedSteps: countDoneSteps(plan),
              totalSteps: plan.steps.length,
              planSnapshot: plan,
            },
          };
        }),
      finishTaskContext: (status, summary) =>
        set((s) => {
          if (!s.taskContext) return {};
          return {
            taskContext: {
              ...s.taskContext,
              status,
              updatedAt: Date.now(),
              summary,
              lastError: status === "failed" ? summary : undefined,
            },
          };
        }),
      clearTaskContext: () => set({ taskContext: null }),
      saveProviderConfig: (config) => set({ providerConfig: config, isSetupComplete: true }),
      setPermission: (key, value) =>
        set((s) => ({ permissions: { ...s.permissions, [key]: value } })),
      setAppPolicyMode: (mode) =>
        set((s) => ({ appPolicy: { ...s.appPolicy, mode } })),
      setAppPolicyEntries: (entries) =>
        set((s) => ({ appPolicy: { ...s.appPolicy, entries } })),
      setBinaryBrainEnabled: (enabled) =>
        set((s) => ({ binaryBrain: { ...s.binaryBrain, enabled } })),
      resetSetup: () => set({ isSetupComplete: false, providerConfig: DEFAULT_PROVIDER_CONFIG }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setBackgroundListening: (backgroundListening) => set({ backgroundListening }),
      saveMacro: (macro) =>
        set((s) => ({
          learnedMacros: [
            ...s.learnedMacros,
            {
              ...macro,
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              runs: macro.runs ?? 0,
              successes: macro.successes ?? 0,
              failures: macro.failures ?? 0,
              lastRunAt: macro.lastRunAt,
            },
          ],
        })),
      deleteMacro: (id) =>
        set((s) => ({ learnedMacros: s.learnedMacros.filter((m) => m.id !== id) })),
      markWorkflowRun: (id) =>
        set((s) => ({
          learnedMacros: s.learnedMacros.map((m) =>
            m.id === id ? { ...m, runs: (m.runs ?? 0) + 1, lastRunAt: Date.now() } : m
          ),
        })),
      markWorkflowOutcome: (id, success) =>
        set((s) => ({
          learnedMacros: s.learnedMacros.map((m) =>
            m.id === id
              ? {
                  ...m,
                  successes: (m.successes ?? 0) + (success ? 1 : 0),
                  failures: (m.failures ?? 0) + (success ? 0 : 1),
                }
              : m
          ),
        })),
      setPendingApproval: (pendingApproval) => set({ pendingApproval }),
    }),
    {
      name: "nova-config",
      partialize: (state) => ({
        providerConfig: state.providerConfig,
        permissions: state.permissions,
        appPolicy: state.appPolicy,
        binaryBrain: state.binaryBrain,
        isSetupComplete: state.isSetupComplete,
        theme: state.theme,
        backgroundListening: state.backgroundListening,
        learnedMacros: state.learnedMacros,
        taskContext: state.taskContext,
      }),
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as Partial<NovaState>) };
        const persistedTask = (persistedState as Partial<NovaState> | undefined)?.taskContext;
        if (persistedTask && persistedTask.status === "running") {
          merged.taskContext = {
            ...persistedTask,
            status: "interrupted",
            updatedAt: Date.now(),
            summary: persistedTask.summary ?? `Task interrupted after restart: ${persistedTask.title}`,
          };
        } else if (persistedTask && !persistedTask.replayPayload) {
          merged.taskContext = {
            ...persistedTask,
            replayPayload:
              persistedTask.type === "youtube_play"
                ? { kind: "youtube_play", query: persistedTask.topic }
                : persistedTask.type === "research"
                ? { kind: "research", steps: [] }
                : { kind: "desktop_task", actions: [] },
          };
        }
        return merged;
      },
    }
  )
);

export function getRecentChatContext(limit = 6): Array<Pick<ChatMessage, "role" | "text">> {
  const messages = useNovaStore.getState().messages;
  return messages.slice(-limit).map(({ role, text }) => ({ role, text }));
}
