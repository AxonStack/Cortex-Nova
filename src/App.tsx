import { useEffect, useRef, useState } from "react";
import { NovaChatInterface, type Attachment } from "./components/NovaOverlay";
import { SetupWizard } from "./components/SetupWizard";
import { useVoiceListener } from "./hooks/useVoiceListener";
import { useNovaStore } from "./store/novaStore";
import type {
  ActivePlan,
  PlanStep,
  ReplayDesktopAction,
  TaskReplayDraft,
} from "./store/novaStore";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { routeCommand, openUrl } from "./lib/commandRouter";
import type { CommandResult } from "./lib/commandRouter";
import { routeViaAI } from "./lib/providerClient";
import { speak } from "./lib/speechSynthesis";
import { remember, trackActivity } from "./lib/memory";
import { closeTaskDialog, showTaskDialog } from "./lib/taskDialogWindow";
import { trainBinaryBrain } from "./lib/binaryBrain";
import { getAdapterCapabilities, type AdapterVerificationHints, type ApprovalPreview } from "./lib/appAdapters";

function NovaApp() {
  const [isHoldingSpace, setIsHoldingSpace] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const holdSpaceRef = useRef(false);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);

  const {
    status, transcript, providerConfig,
    setStatus, setTranscript, setResponse,
    addMessage, clearMessages, resetSetup, theme,
    addActionLog, setPlan, updatePlanStep, clearPlan,
    beginTaskContext, syncTaskPlan, finishTaskContext,
    backgroundListening, setBackgroundListening, setError, activePlan, permissions, appPolicy, setPermission,
    setPendingApproval,
  } = useNovaStore();

  function requestApproval(preview: ApprovalPreview): Promise<boolean> {
    return new Promise((resolve) => {
      approvalResolveRef.current = resolve;
      setPendingApproval({ id: crypto.randomUUID(), preview });
    });
  }

  function resolveApproval(approved: boolean) {
    setPendingApproval(null);
    approvalResolveRef.current?.(approved);
    approvalResolveRef.current = null;
  }
  const openaiKey = providerConfig.provider === "openai" ? providerConfig.apiKey : undefined;
  const { voiceSupported, linuxVoiceAvailable, startCommandListening, stopCommandListening, resumeWakeWord, stopAll } =
    useVoiceListener(backgroundListening, openaiKey);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (activePlan) {
      void showTaskDialog(activePlan);
      return;
    }
    void closeTaskDialog();
  }, [activePlan]);

  useEffect(() => {
    if (activePlan) syncTaskPlan(activePlan);
  }, [activePlan, syncTaskPlan]);

  async function toggleBackgroundListening() {
    if (backgroundListening) {
      stopAll();
      setBackgroundListening(false);
      addActionLog({ ts: Date.now(), type: "memory", label: "Background listening paused" });
      trackActivity("command", "Background listening paused");
      return;
    }

    if (voiceSupported === false) {
      setError("Voice recognition is not available in this installed app environment. Use text input or run in a Chromium browser with microphone access.");
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia unavailable");
      }
      const stream = await navigator.mediaDevices?.getUserMedia?.({ audio: true });
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      setError("Microphone access denied. Allow microphone permission, then turn background listening on again.");
      return;
    }

    const prompt = 'Background learning is on. Say "chop chop cortex" to wake me up.';
    setBackgroundListening(true);
    setError(null);
    setStatus("idle");
    setTranscript("");
    setResponse(prompt);
    addMessage({ role: "ai", text: prompt });
    addActionLog({ ts: Date.now(), type: "memory", label: "Background learning enabled. Wake phrase: chop chop cortex" });
    trackActivity("command", "Background learning enabled with wake phrase chop chop cortex");
    speak(prompt);
  }

  // Ollama health check
  useEffect(() => {
    if (providerConfig.provider !== "ollama") return;
    const check = async () => {
      try {
        const res = await fetch(`${providerConfig.ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(2500),
        });
        setOllamaConnected(res.ok);
      } catch {
        setOllamaConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [providerConfig.provider, providerConfig.ollamaUrl]);

  type DesktopAction = Extract<
    CommandResult,
    {
      type:
        | "browser_navigate"
        | "desktop_open_app"
        | "desktop_close_app"
        | "desktop_focus_window"
        | "desktop_press_key"
        | "desktop_type_text"
        | "desktop_mouse_click"
    }
  >;

  const isDesktopAction = (result: CommandResult): result is DesktopAction =>
    result.type === "browser_navigate" ||
    result.type === "desktop_open_app" ||
    result.type === "desktop_close_app" ||
    result.type === "desktop_focus_window" ||
    result.type === "desktop_press_key" ||
    result.type === "desktop_type_text" ||
    result.type === "desktop_mouse_click";

  function toReplayDesktopAction(action: DesktopAction): ReplayDesktopAction {
    const id = crypto.randomUUID();
    switch (action.type) {
      case "desktop_open_app":
        return { id, kind: action.type, app: action.app, label: action.label };
      case "desktop_close_app":
        return { id, kind: action.type, app: action.app, label: action.label };
      case "browser_navigate":
        return { id, kind: action.type, url: action.url, label: action.label };
      case "desktop_focus_window":
        return { id, kind: action.type, name: action.name, label: action.label };
      case "desktop_press_key":
        return { id, kind: action.type, keys: action.keys, label: action.label };
      case "desktop_type_text":
        return { id, kind: action.type, text: action.text, label: action.label };
      case "desktop_mouse_click":
        return { id, kind: action.type, x: action.x, y: action.y, label: action.label };
    }
  }

  function fromReplayDesktopAction(action: ReplayDesktopAction): DesktopAction {
    switch (action.kind) {
      case "desktop_open_app":
        return { type: action.kind, app: action.app, label: action.label };
      case "desktop_close_app":
        return { type: action.kind, app: action.app, label: action.label };
      case "browser_navigate":
        return { type: action.kind, url: action.url, label: action.label };
      case "desktop_focus_window":
        return { type: action.kind, name: action.name, label: action.label };
      case "desktop_press_key":
        return { type: action.kind, keys: action.keys, label: action.label };
      case "desktop_type_text":
        return { type: action.kind, text: action.text, label: action.label };
      case "desktop_mouse_click":
        return { type: action.kind, x: action.x, y: action.y, label: action.label };
    }
  }

  const describeDesktopAction = (action: DesktopAction): { label: string; detail?: string } => {
    switch (action.type) {
      case "browser_navigate":
        return { label: action.label, detail: action.url };
      case "desktop_open_app":
        return { label: action.label, detail: action.app };
      case "desktop_close_app":
        return { label: action.label, detail: action.app };
      case "desktop_focus_window":
        return { label: action.label, detail: action.name };
      case "desktop_press_key":
        return { label: action.label, detail: action.keys };
      case "desktop_type_text":
        return { label: "Typing text", detail: action.text };
      case "desktop_mouse_click":
        return { label: "Mouse click", detail: `(${action.x}, ${action.y})` };
    }
  };

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function invokeWithRetry<T = unknown>(
    command: string,
    args: Record<string, unknown>,
    retries = 2,
    baseDelayMs = 220,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await invoke<T>(command, args);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await delay(baseDelayMs * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  function appNameAliases(name: string, hints?: AdapterVerificationHints): string[] {
    const base = name.trim();
    if (!base) return [];
    const lower = base.toLowerCase();
    const aliases = new Set<string>([base]);
    const hinted = hints?.appAliases?.[lower] ?? [];
    for (const alias of hinted) aliases.add(alias);
    if (lower.includes("telegram")) aliases.add("telegram");
    if (lower.includes("chrome")) aliases.add("chrome");
    if (lower.includes("firefox")) aliases.add("firefox");
    if (lower.includes("discord")) aliases.add("discord");
    return Array.from(aliases);
  }

  function requiredPermissionForAction(action: DesktopAction): keyof typeof permissions {
    if (action.type === "desktop_type_text" || action.type === "desktop_mouse_click" || action.type === "desktop_press_key") {
      return "keyboardMouseControl";
    }
    if (action.type === "browser_navigate") return "browserControl";
    return "appControl";
  }

  async function ensureDesktopPermissions(actions: DesktopAction[]): Promise<boolean> {
    const request = async (message: string) =>
      await confirm(message, { title: "Cortex Nova Permission", kind: "warning", okLabel: "Allow", cancelLabel: "Deny" });

    if (!permissions.desktopAutomation) {
      const allowDesktop = await request("Nova needs Desktop Automation permission to continue. Allow now?");
      if (!allowDesktop) {
        const msg = "Desktop automation permission denied. You can enable it anytime in the Permissions tab.";
        addMessage({ role: "ai", text: msg });
        setResponse(msg);
        setStatus("speaking");
        speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
        return false;
      }
      setPermission("desktopAutomation", true);
    }
    const missing = actions
      .map(requiredPermissionForAction)
      .find((key) => !permissions[key]);
    if (!missing) return true;
    const grant = await request(`Nova needs ${missing} permission for this task. Allow now?`);
    if (grant) {
      setPermission(missing, true);
      return true;
    }
    const labels: Record<keyof typeof permissions, string> = {
      desktopAutomation: "desktop automation",
      appControl: "app control",
      browserControl: "browser control",
      keyboardMouseControl: "keyboard and mouse control",
    };
    const msg = `Permission required: ${labels[missing]}. Open the Permissions tab and enable it, then ask again.`;
    addMessage({ role: "ai", text: msg });
    setResponse(msg);
    setStatus("speaking");
    speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
    return false;
  }

  function isHighRiskAction(action: DesktopAction): boolean {
    if (action.type === "desktop_press_key") {
      const k = action.keys.toLowerCase();
      return k === "return" || k === "ctrl+return";
    }
    if (action.type === "desktop_type_text") {
      const t = action.text.toLowerCase();
      return /\b(password|passcode|secret|token|api[_ -]?key)\b/.test(t);
    }
    return false;
  }

  async function ensureHighRiskApproval(actions: DesktopAction[]): Promise<boolean> {
    const risky = actions.filter(isHighRiskAction);
    if (!risky.length) return true;
    const summary = risky.slice(0, 3).map((a) => describeDesktopAction(a).label).join("; ");
    return confirm(
      `High-risk actions detected: ${summary}. Continue?`,
      { title: "Cortex Nova Safety Check", kind: "warning", okLabel: "Continue", cancelLabel: "Cancel" }
    );
  }

  function appPolicyBlocks(action: DesktopAction): string | null {
    if (appPolicy.mode === "off") return null;
    const target = (
      action.type === "desktop_open_app" || action.type === "desktop_close_app"
        ? action.app
        : action.type === "desktop_focus_window"
        ? action.name
        : ""
    ).toLowerCase();
    if (!target) return null;
    const entries = appPolicy.entries.map((e) => e.toLowerCase().trim()).filter(Boolean);
    if (!entries.length) return null;
    const matches = entries.some((e) => target.includes(e));
    if (appPolicy.mode === "allowlist" && !matches) return `Blocked by allowlist policy: "${target}" is not approved.`;
    if (appPolicy.mode === "denylist" && matches) return `Blocked by denylist policy: "${target}" is denied.`;
    return null;
  }

  async function ensureBrowserPermission(): Promise<boolean> {
    return ensureDesktopPermissions([
      { type: "browser_navigate", url: "about:blank", label: "Opening browser" },
    ]);
  }

  // Build the visible checkpoint list for a single desktop action — multiple
  // sub-steps per action so the user sees granular progress (Locating → Launching →
  // Application opened, etc.) rather than a single instant tick.
  function planStepsForAction(action: DesktopAction): PlanStep[] {
    const id = () => crypto.randomUUID();
    switch (action.type) {
      case "desktop_open_app":
        return [
          { id: id(), label: `Locating ${action.app}`,    detail: "Searching system for the application", status: "pending" },
          { id: id(), label: `Launching ${action.app}`,   detail: "Starting the process",                  status: "pending" },
          { id: id(), label: "Application opened",        detail: action.label,                            status: "pending" },
        ];
      case "desktop_close_app":
        return [
          { id: id(), label: `Finding ${action.app}`,     detail: "Looking for the running application",   status: "pending" },
          { id: id(), label: `Closing ${action.app}`,     detail: "Sending quit/terminate request",        status: "pending" },
          { id: id(), label: "Application closed",        detail: action.label,                            status: "pending" },
        ];
      case "desktop_focus_window":
        return [
          { id: id(), label: `Finding ${action.name}`,    detail: "Searching for the window",              status: "pending" },
          { id: id(), label: `Focusing ${action.name}`,   detail: "Bringing it to the foreground",         status: "pending" },
          { id: id(), label: "Window ready",              detail: action.label,                            status: "pending" },
        ];
      case "desktop_press_key":
        return [
          { id: id(), label: "Preparing keystroke",       detail: "Resolving key sequence",                status: "pending" },
          { id: id(), label: `Pressing ${action.keys}`,   detail: "Sending keyboard shortcut",             status: "pending" },
          { id: id(), label: "Keystroke sent",            detail: action.label,                            status: "pending" },
        ];
      case "browser_navigate":
        return [
          { id: id(), label: "Opening default browser",   detail: "Handing URL to the system",             status: "pending" },
          { id: id(), label: "Loading page",              detail: action.url,                              status: "pending" },
          { id: id(), label: "Page ready",                detail: action.label,                            status: "pending" },
        ];
      case "desktop_type_text":
        return [
          { id: id(), label: "Acquiring keyboard",        detail: "Preparing input simulation",            status: "pending" },
          { id: id(), label: `Typing "${action.text}"`,   detail: action.text,                             status: "pending" },
          { id: id(), label: "Text entered",              detail: action.label,                            status: "pending" },
        ];
      case "desktop_mouse_click":
        return [
          { id: id(), label: "Acquiring mouse",           detail: "Preparing pointer control",             status: "pending" },
          { id: id(), label: `Clicking at (${action.x}, ${action.y})`, detail: "Sending click event",      status: "pending" },
          { id: id(), label: "Click delivered",           detail: action.label,                            status: "pending" },
        ];
    }
  }

  async function runActionWithCheckpoints(
    action: DesktopAction,
    stepIds: [string, string, string],
    verificationHints?: AdapterVerificationHints,
  ) {
    const [s1, s2, s3] = stepIds;

    if (action.type === "browser_navigate") {
      updatePlanStep(s1, "active");
      await delay(150);
      await invokeWithRetry("open_url", { url: action.url });
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await delay(900);
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(250);
      updatePlanStep(s3, "done");
      trackActivity("open", action.url);

    } else if (action.type === "desktop_open_app") {
      updatePlanStep(s1, "active");
      await delay(200);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invokeWithRetry("open_application", { app: action.app });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(700);
      // Post-action verification should be best-effort: some apps open slowly
      // or under a process/window name variant.
      const aliases = appNameAliases(action.app, verificationHints);
      let focused = false;
      for (const alias of aliases) {
        try {
          await invokeWithRetry("focus_window", { name: alias }, 1, 220);
          focused = true;
          break;
        } catch {
          // Try next alias.
        }
      }
      if (!focused) {
        await delay(450);
      }
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_close_app") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      try {
        await invokeWithRetry("close_application", { app: action.app }, 1, 260);
      } catch {
        // If the first close did not land, try once more after a short pause.
        await delay(300);
        await invokeWithRetry("close_application", { app: action.app }, 1, 260);
      }
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(400);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_focus_window") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      const focusTargets = [
        action.name,
        ...(verificationHints?.focusTargets ?? []),
      ].filter((value, index, arr) => value && arr.indexOf(value) === index);
      let focusErr: unknown = null;
      let focused = false;
      for (const target of focusTargets) {
        try {
          await invokeWithRetry("focus_window", { name: target });
          focused = true;
          break;
        } catch (err) {
          focusErr = err;
        }
      }
      if (!focused) {
        throw focusErr instanceof Error ? focusErr : new Error(`Could not focus ${action.name}`);
      }
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(250);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_press_key") {
      updatePlanStep(s1, "active");
      await delay(100);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invokeWithRetry("press_key", { keys: action.keys });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(120);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_type_text") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invokeWithRetry("type_text", { text: action.text });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(150);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_mouse_click") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invokeWithRetry("mouse_click", { x: action.x, y: action.y });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(150);
      updatePlanStep(s3, "done");
    }
  }

  async function executeDesktopActions(title: string, actions: DesktopAction[], summary?: string, sourceCommand = transcript) {
    const adapterCapabilitiesEarly = getAdapterCapabilities(actions);
    if (adapterCapabilitiesEarly?.approvalPreview) {
      const approved = await requestApproval(adapterCapabilitiesEarly.approvalPreview);
      if (!approved) {
        const msg = "Cancelled. You chose not to proceed with the send.";
        addMessage({ role: "ai", text: msg });
        setResponse(msg);
        setStatus("speaking");
        speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
        return;
      }
    }

    if (!(await ensureDesktopPermissions(actions))) return;
    for (const action of actions) {
      const blocked = appPolicyBlocks(action);
      if (blocked) {
        addMessage({ role: "ai", text: blocked });
        setResponse(blocked);
        setStatus("speaking");
        speak(blocked, () => { setStatus("idle"); resumeWakeWord(); });
        return;
      }
    }
    if (!adapterCapabilitiesEarly?.approvalPreview && !(await ensureHighRiskApproval(actions))) {
      const msg = "Cancelled. High-risk action was not approved.";
      addMessage({ role: "ai", text: msg });
      setResponse(msg);
      setStatus("speaking");
      speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
      return;
    }

    // Expand every action into its 3 sub-checkpoints
    const expanded: { action: DesktopAction; steps: PlanStep[] }[] = actions.map((action) => ({
      action,
      steps: planStepsForAction(action),
    }));
    const allSteps: PlanStep[] = expanded.flatMap((e) => e.steps);
    const plan: ActivePlan = { title, topic: title, type: "desktop_task", steps: allSteps };
    beginTaskContext(sourceCommand, plan, {
      kind: "desktop_task",
      actions: actions.map(toReplayDesktopAction),
    });
    setPlan(plan);
    addMessage({ role: "ai", text: title });
    trackActivity("command", title);
    const adapterCapabilities = adapterCapabilitiesEarly;
    if (adapterCapabilities?.executionText?.startMessage) {
      addMessage({ role: "ai", text: adapterCapabilities.executionText.startMessage });
    }

    try {
      for (const { action, steps } of expanded) {
        const ids: [string, string, string] = [steps[0].id, steps[1].id, steps[2].id];
        await runActionWithCheckpoints(action, ids, adapterCapabilities?.verificationHints);
        addActionLog({ ts: Date.now(), type: "os", label: describeDesktopAction(action).label });
      }
    } catch (err) {
      const idx = allSteps.findIndex((s) => s.status === "active");
      const errMsg = err instanceof Error ? err.message : String(err);
      if (idx >= 0) updatePlanStep(allSteps[idx].id, "error", errMsg);
      const spoken = adapterCapabilities?.executionText?.failureMessage ?? `Sorry, something went wrong: ${errMsg}`;
      finishTaskContext("failed", spoken);
      remember(`Task failed: ${title}. ${spoken}`, "cmd", 0.72);
      addMessage({ role: "ai", text: spoken });
      setResponse(spoken);
      setStatus("speaking");
      speak(spoken, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 4000); });
      return;
    }

    const finalMessage = adapterCapabilities?.executionText?.successMessage ?? (summary ?? actions.map((a) => a.label).join(". "));
    finishTaskContext("completed", finalMessage);
    remember(`Task completed: ${title}. ${finalMessage}`, "cmd", 0.78);
    setResponse(finalMessage);
    addMessage({ role: "ai", text: finalMessage });
    setStatus("speaking");
    trainBinaryBrain(transcript, actions.map((a) => a.label));
    // Keep dialog visible for 5s after the spoken summary so user sees all the green ticks.
    speak(finalMessage, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 5000); });
  }

  // Multi-step YouTube automation — every visible phase is a checkpoint.
  async function executeYouTubePlay(query: string, sourceCommand = transcript) {
    if (!(await ensureBrowserPermission())) return;

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const id = () => crypto.randomUUID();
    const steps: PlanStep[] = [
      { id: id(), label: "Opening browser",          detail: "Launching default web browser",     status: "pending" },
      { id: id(), label: "Loading YouTube",          detail: "https://www.youtube.com",           status: "pending" },
      { id: id(), label: `Searching "${query}"`,     detail: "Submitting search query",           status: "pending" },
      { id: id(), label: "Loading results",          detail: "Waiting for search results page",   status: "pending" },
      { id: id(), label: "Selecting first video",    detail: "Tabbing to first result",           status: "pending" },
      { id: id(), label: `Playing "${query}"`,       detail: "Pressing Enter to start playback",  status: "pending" },
    ];

    const plan: ActivePlan = { title: `Playing: ${query}`, topic: query, type: "youtube_play", steps };
    beginTaskContext(sourceCommand, plan, { kind: "youtube_play", query });
    setPlan(plan);
    addMessage({ role: "ai", text: `Opening YouTube to play "${query}".` });
    trackActivity("command", `youtube:${query}`);

    const step = (i: number, s: PlanStep["status"]) => updatePlanStep(steps[i].id, s);

    // 1. Open browser via xdg-open (no portal dialog, works on X11 + Wayland)
    step(0, "active");
    await invoke("open_url", { url: searchUrl });
    await delay(800);
    step(0, "done");

    // 2. Brief pause for browser window to appear
    step(1, "active");
    await delay(900);
    step(1, "done");

    // 3. The search URL already includes the query → mark submitted
    step(2, "active");
    await delay(700);
    step(2, "done");

    // 4. Wait for the YouTube results page to render
    step(3, "active");
    await delay(2200);
    step(3, "done");

    // 5. Best-effort keyboard navigation to first result.
    step(4, "active");
    let keyNavOk = true;
    try {
      await invoke("focus_window", { name: "YouTube" });
      await delay(400);
      for (let i = 0; i < 14; i++) {
        await invoke("press_key", { keys: "Tab" });
        await delay(60);
      }
    } catch {
      keyNavOk = false;
    }
    step(4, "done");

    // 6. Press Enter to play the first result
    step(5, "active");
    if (keyNavOk) {
      try { await invoke("press_key", { keys: "Return" }); } catch { /* best-effort */ }
    }
    await delay(300);
    step(5, "done");

    setStatus("speaking");
    const summary = keyNavOk
      ? `Playing "${query}" on YouTube.`
      : `Opened YouTube search for "${query}". Click the first result to play.`;
    finishTaskContext("completed", summary);
    remember(`Task completed: Play YouTube "${query}". ${summary}`, "cmd", 0.74);
    setResponse(summary);
    addMessage({ role: "ai", text: summary });
    trainBinaryBrain(transcript, [`youtube:${query}`]);
    speak(summary, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 5000); });
  }

  // Execute a research plan step-by-step
  async function executeResearchPlan(
    topic: string,
    steps: Array<{ id: string; label: string; detail: string; url: string; delayMs: number }>,
    sourceCommand = transcript,
  ) {
    if (!(await ensureBrowserPermission())) return;

    const planSteps: PlanStep[] = steps.map((s) => ({
      id: s.id,
      label: s.label,
      detail: s.detail,
      status: "pending",
    }));

    const plan: ActivePlan = { title: `Researching: ${topic}`, topic, type: "research", steps: planSteps };
    beginTaskContext(sourceCommand, plan, { kind: "research", steps });
    setPlan(plan);
    addMessage({ role: "ai", text: `Starting research on "${topic}" — opening ${steps.length} sources.` });
    trackActivity("research", topic);

    for (const step of steps) {
      // Small pause before firing each step
      if (step.delayMs > 0) {
        await new Promise((r) => setTimeout(r, step.delayMs - (steps[0].delayMs ?? 0)));
      }
      updatePlanStep(step.id, "active");
      try {
        await openUrl(step.url);
        trackActivity("open", step.url);
        addActionLog({ ts: Date.now(), type: "research", label: step.detail });
        // Brief pause so user sees the "active" state
        await new Promise((r) => setTimeout(r, 700));
        updatePlanStep(step.id, "done");
      } catch {
        updatePlanStep(step.id, "error", "Failed to open");
      }
    }

    setStatus("speaking");
    const summary = `Opened ${steps.length} sources for "${topic}". Check your browser.`;
    finishTaskContext("completed", summary);
    remember(`Task completed: Research ${topic}. ${summary}`, "cmd", 0.76);
    setResponse(summary);
    addMessage({ role: "ai", text: summary });
    trainBinaryBrain(transcript, [`research:${topic}`]);
    speak(summary, () => {
      setStatus("idle");
      resumeWakeWord();
      // Keep plan visible for 4 seconds after completion so user can see it
      setTimeout(() => clearPlan(), 4000);
    });
  }

  // Process transcript
  useEffect(() => {
    if (status !== "listening" || !transcript.trim() || isHoldingSpace) return;

    const handle = async () => {
      const workflowMatch = transcript.trim().match(/^workflow:([a-f0-9-]{8,})::([\s\S]+)$/i);
      const workflowId = workflowMatch?.[1];
      const rawInput = (workflowMatch?.[2] ?? transcript).trim();
      const isSimulation = /^(?:simulate|plan only|dry run)\b/i.test(rawInput);
      const normalizedInput = rawInput.replace(/^(?:simulate|plan only|dry run)\s*[:\-]?\s*/i, "").trim() || rawInput;
      const attachments = pendingAttachmentsRef.current.splice(0);
      addMessage({ role: "user", text: transcript });
      setStatus("processing");
      const t0 = performance.now();

      try {
        const taskContext = useNovaStore.getState().taskContext;
        const wantsTaskResume = /^(?:resume|continue|retry|rerun|run again)(?:\s+(?:my|the))?\s+(?:last|previous)\s+task$/i.test(normalizedInput);
        const wantsTaskSummary = /^(?:what was|show|recap|summarize)(?:\s+(?:my|the))?\s+(?:last|previous)\s+task$/i.test(normalizedInput);

        if (wantsTaskSummary) {
          const msg = taskContext
            ? `Last task: ${taskContext.title}. Status: ${taskContext.status}. ${taskContext.summary ?? "No summary stored yet."}`
            : "I do not have a previous task stored yet.";
          const latencyMs = Math.round(performance.now() - t0);
          addActionLog({ ts: Date.now(), type: "memory", label: msg, latencyMs });
          addMessage({ role: "ai", text: msg, latencyMs });
          setResponse(msg);
          setStatus("speaking");
          speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
          return;
        }

        const effectiveInput =
          wantsTaskResume && taskContext?.sourceCommand
            ? taskContext.sourceCommand
            : normalizedInput;

        if (wantsTaskResume && !taskContext?.sourceCommand) {
          const msg = "I do not have a resumable task yet.";
          addMessage({ role: "ai", text: msg });
          setResponse(msg);
          setStatus("speaking");
          speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
          return;
        }

        if (wantsTaskResume && taskContext?.sourceCommand) {
          addMessage({ role: "ai", text: `Resuming previous task: ${taskContext.title}.` });
        }

        if (isSimulation && !attachments.length) {
          const sim = await routeCommand(effectiveInput);
          const simMsg =
            sim.type === "command_chain" ? `Simulation only: would run ${sim.steps.length} planned steps.`
            : sim.type === "youtube_play" ? `Simulation only: would play "${sim.query}" on YouTube.`
            : sim.type === "live_score" ? `Simulation only: would open live score for ${sim.query}.`
            : sim.type === "research" ? `Simulation only: would run research plan for "${sim.topic}".`
            : sim.type === "os_action" ? `Simulation only: ${sim.message}`
            : isDesktopAction(sim) ? `Simulation only: would execute "${sim.label}".`
            : `Simulation only: would query AI with "${sim.query}".`;
          addMessage({ role: "ai", text: simMsg });
          setResponse(simMsg);
          setStatus("speaking");
          speak(simMsg, () => { setStatus("idle"); resumeWakeWord(); });
          if (workflowId) useNovaStore.getState().markWorkflowOutcome(workflowId, true);
          return;
        }

        // If there are image attachments, skip OS routing and go straight to AI vision
        if (attachments.length > 0) {
          const imageAtts = attachments.filter((a) => a.mimeType.startsWith("image/"));
          const docAtts = attachments.filter((a) => !a.mimeType.startsWith("image/"));
          const docContext = docAtts.map((a) => {
            try {
              const b64 = a.dataUrl.split(",")[1] ?? "";
              return `[Document: ${a.name}]\n${atob(b64)}`;
            } catch { return `[Document: ${a.name}]`; }
          }).join("\n\n");
          const queryWithDocs = docContext ? `${docContext}\n\n${effectiveInput}` : effectiveInput;
          trackActivity("ai", queryWithDocs);
          const aiResult = await routeViaAI(queryWithDocs, providerConfig, imageAtts);
          const latencyMs = Math.round(performance.now() - t0);
          addActionLog({ ts: Date.now(), type: "ai", label: transcript, latencyMs });
          if (aiResult.type === "os_action") {
            addMessage({ role: "ai", text: aiResult.message, latencyMs });
            setResponse(aiResult.message);
            setStatus("speaking");
            speak(aiResult.message, () => { setStatus("idle"); resumeWakeWord(); });
          } else if (isDesktopAction(aiResult)) {
            await executeDesktopActions(aiResult.label, [aiResult], aiResult.label, effectiveInput);
          }
          if (workflowId) useNovaStore.getState().markWorkflowOutcome(workflowId, true);
          return;
        }

        const result = await routeCommand(effectiveInput);

        if (result.type === "command_chain") {
          const last = result.steps[result.steps.length - 1];
          const desktopSteps = result.steps.filter(isDesktopAction);

          if (desktopSteps.length === result.steps.length) {
            await executeDesktopActions(
              "Desktop task in progress",
              desktopSteps,
              desktopSteps.map((step) => step.label).join(". "),
              effectiveInput,
            );

          } else if (last.type === "youtube_play") {
            addActionLog({ ts: Date.now(), type: "os", label: `YouTube: ${last.query}` });
            await executeYouTubePlay(last.query, effectiveInput);

          } else if (last.type === "live_score") {
            await executeDesktopActions(
              `Opening live score for ${last.query}`,
              [{ type: "browser_navigate", url: last.url, label: `Opening live score for ${last.query}` }],
              `Opening live score for ${last.query}.`,
              effectiveInput,
            );

          } else if (last.type === "research") {
            trackActivity("research", last.topic);
            addActionLog({ ts: Date.now(), type: "research", label: `Researching: ${last.topic}` });
            await executeResearchPlan(last.topic, last.steps, effectiveInput);

          } else if (last.type === "os_action") {
            const message = last.message;
            const latencyMs = Math.round(performance.now() - t0);
            trackActivity("command", message);
            addActionLog({ ts: Date.now(), type: "os", label: message, latencyMs });
            addMessage({ role: "ai", text: message, latencyMs });
            setResponse(message);
            setStatus("speaking");
            speak(message, () => {
              setStatus("idle");
              resumeWakeWord();
            });

          } else if (last.type === "ai_query") {
            trackActivity("ai", last.query);
            const aiResult = await routeViaAI(last.query, providerConfig);
            const latencyMs = Math.round(performance.now() - t0);
            addActionLog({ ts: Date.now(), type: "ai", label: last.query, latencyMs });
            if (aiResult.type === "youtube_play") {
              await executeYouTubePlay(aiResult.query, effectiveInput);
            } else if (isDesktopAction(aiResult)) {
              await executeDesktopActions(aiResult.label, [aiResult], aiResult.label, effectiveInput);
            } else if (aiResult.type === "research") {
              await executeResearchPlan(aiResult.topic, aiResult.steps, effectiveInput);
            } else {
              const msg = aiResult.type === "os_action" ? aiResult.message : "Done.";
              addMessage({ role: "ai", text: msg, latencyMs });
              setResponse(msg);
              setStatus("speaking");
              speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
            }
          } else {
            throw new Error("Nested command chains are not supported.");
          }

        } else if (result.type === "youtube_play") {
          addActionLog({ ts: Date.now(), type: "os", label: `YouTube: ${result.query}` });
          await executeYouTubePlay(result.query, effectiveInput);

        } else if (isDesktopAction(result)) {
          await executeDesktopActions(result.label, [result], result.label, effectiveInput);

        } else if (result.type === "live_score") {
          await executeDesktopActions(
            `Opening live score for ${result.query}`,
            [{ type: "browser_navigate", url: result.url, label: `Opening live score for ${result.query}` }],
            `Opening live score for ${result.query}.`,
            effectiveInput,
          );

        } else if (result.type === "research") {
          trackActivity("research", result.topic);
          addActionLog({ ts: Date.now(), type: "research", label: `Researching: ${result.topic}` });
          await executeResearchPlan(result.topic, result.steps, effectiveInput);

        } else if (result.type === "os_action") {
          const latencyMs = Math.round(performance.now() - t0);
          const logType = /^(?:Remembered|Removed|From memory)/i.test(result.message) ? "memory" : "os";
          trackActivity(logType === "memory" ? "command" : "command", result.message);
          addActionLog({ ts: Date.now(), type: logType, label: result.message, latencyMs });
          addMessage({ role: "ai", text: result.message, latencyMs });
          setResponse(result.message);
          setStatus("speaking");
          speak(result.message, () => {
            setStatus("idle");
            resumeWakeWord();
          });

        } else {
          // ai_query: route through Claude tool use so OS requests ("open Spotify",
          // "can you launch telegram") are executed instead of refused as chat.
          trackActivity("ai", result.query);
          const aiResult = await routeViaAI(result.query, providerConfig);
          const latencyMs = Math.round(performance.now() - t0);
          addActionLog({ ts: Date.now(), type: "ai", label: result.query, latencyMs });

          if (aiResult.type === "command_chain") {
            // Claude used multiple tools — run each in sequence, each with its own
            // checkpoint dialog. Each phase shows its own progress before the next starts.
            const desktopSubset = aiResult.steps.filter(isDesktopAction);
            if (desktopSubset.length === aiResult.steps.length) {
              // All are simple desktop actions → run as a single multi-step plan
              await executeDesktopActions(
                "Running task",
                desktopSubset,
                desktopSubset.map((s) => s.label).join(". "),
                effectiveInput,
              );
            } else {
              // Mixed (e.g. open app + youtube_play) → run sequentially
              for (const sub of aiResult.steps) {
                if (sub.type === "youtube_play") {
                  await executeYouTubePlay(sub.query, effectiveInput);
                } else if (isDesktopAction(sub)) {
                  await executeDesktopActions(sub.label, [sub], sub.label, effectiveInput);
                } else if (sub.type === "research") {
                  await executeResearchPlan(sub.topic, sub.steps, effectiveInput);
                } else if (sub.type === "os_action") {
                  addMessage({ role: "ai", text: sub.message });
                }
              }
            }
          } else if (aiResult.type === "youtube_play") {
            await executeYouTubePlay(aiResult.query, effectiveInput);
          } else if (isDesktopAction(aiResult)) {
            await executeDesktopActions(aiResult.label, [aiResult], aiResult.label, effectiveInput);
          } else if (aiResult.type === "research") {
            await executeResearchPlan(aiResult.topic, aiResult.steps, effectiveInput);
          } else {
            // os_action → spoken response
            const msg = aiResult.type === "os_action" ? aiResult.message : "Done.";
            addMessage({ role: "ai", text: msg, latencyMs });
            setResponse(msg);
            setStatus("speaking");
            speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
          }
        }
        if (workflowId) useNovaStore.getState().markWorkflowOutcome(workflowId, true);
      } catch (err) {
        if (workflowId) useNovaStore.getState().markWorkflowOutcome(workflowId, false);
        clearPlan();
        useNovaStore.getState().setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    };

    const t = setTimeout(handle, 600);
    return () => clearTimeout(t);
  }, [transcript, status, isHoldingSpace, providerConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spacebar hold-to-talk
  useEffect(() => {
    const anyVoice = voiceSupported || linuxVoiceAvailable === true;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (anyVoice && !e.repeat && !holdSpaceRef.current) {
          holdSpaceRef.current = true;
          setIsHoldingSpace(true);
          setTranscript("");
          setResponse("");
          startCommandListening("hold");
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holdSpaceRef.current) return;
      e.preventDefault();
      holdSpaceRef.current = false;
      setIsHoldingSpace(false);
      stopCommandListening();
      if (!useNovaStore.getState().transcript.trim()) {
        setStatus("idle");
        resumeWakeWord();
      }
    };

    const onWindowBlur = () => {
      if (!holdSpaceRef.current) return;
      holdSpaceRef.current = false;
      setIsHoldingSpace(false);
      stopCommandListening();
      if (!useNovaStore.getState().transcript.trim()) {
        setStatus("idle");
        resumeWakeWord();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [voiceSupported, linuxVoiceAvailable, startCommandListening, stopCommandListening, resumeWakeWord, setTranscript, setResponse, setStatus]);

  function submitText(text: string, attachments?: Attachment[]) {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (attachments && attachments.length > 0) {
      pendingAttachmentsRef.current = attachments;
    }
    setTranscript(text.trim() || "(image attached)");
    setStatus("listening");
  }

  async function replayTaskDraft(draft: TaskReplayDraft) {
    setError(null);
    setStatus("processing");
    addMessage({ role: "user", text: `Replay task: ${draft.title}` });

    try {
      if (draft.payload.kind === "desktop_task") {
        const actions = draft.payload.actions.map(fromReplayDesktopAction);
        if (!actions.length) throw new Error("No desktop steps selected for replay.");
        await executeDesktopActions(
          draft.title,
          actions,
          actions.map((action) => action.label).join(". "),
          draft.sourceCommand || draft.title,
        );
        return;
      }

      if (draft.payload.kind === "youtube_play") {
        const query = draft.payload.query.trim();
        if (!query) throw new Error("YouTube replay query is empty.");
        await executeYouTubePlay(query, draft.sourceCommand || draft.title);
        return;
      }

      const steps = draft.payload.steps;
      if (!steps.length) throw new Error("No research steps selected for replay.");
      await executeResearchPlan(
        draft.title.replace(/^Researching:\s*/i, "").trim() || draft.title,
        steps,
        draft.sourceCommand || draft.title,
      );
    } catch (err) {
      clearPlan();
      const msg = err instanceof Error ? err.message : "Replay failed.";
      useNovaStore.getState().setError(msg);
      setStatus("error");
    }
  }

  return (
    <NovaChatInterface
      isHoldingSpace={isHoldingSpace}
      voiceSupported={voiceSupported || linuxVoiceAvailable === true}
      backgroundListening={backgroundListening}
      ollamaConnected={ollamaConnected}
      onSubmitText={submitText}
      onReplayTaskDraft={replayTaskDraft}
      onToggleBackgroundListening={toggleBackgroundListening}
      onClearChat={clearMessages}
      onResetSetup={resetSetup}
      onApprovalDecision={resolveApproval}
    />
  );
}

function App() {
  const { isSetupComplete } = useNovaStore();
  return isSetupComplete ? <NovaApp /> : <SetupWizard />;
}

export default App;
