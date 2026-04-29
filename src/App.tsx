import { useEffect, useRef, useState } from "react";
import { NovaChatInterface, type Attachment } from "./components/NovaOverlay";
import { SetupWizard } from "./components/SetupWizard";
import { useVoiceListener } from "./hooks/useVoiceListener";
import { useNovaStore } from "./store/novaStore";
import type { PlanStep } from "./store/novaStore";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { routeCommand, openUrl } from "./lib/commandRouter";
import type { CommandResult } from "./lib/commandRouter";
import { routeViaAI } from "./lib/providerClient";
import { speak } from "./lib/speechSynthesis";
import { trackActivity } from "./lib/memory";
import { closeTaskDialog, showTaskDialog } from "./lib/taskDialogWindow";
import { trainBinaryBrain } from "./lib/binaryBrain";

function NovaApp() {
  const [isHoldingSpace, setIsHoldingSpace] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const holdSpaceRef = useRef(false);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const {
    status, transcript, providerConfig,
    setStatus, setTranscript, setResponse,
    addMessage, clearMessages, resetSetup, theme,
    addActionLog, setPlan, updatePlanStep, clearPlan,
    backgroundListening, setBackgroundListening, setError, activePlan, permissions, setPermission,
  } = useNovaStore();
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

  async function runActionWithCheckpoints(action: DesktopAction, stepIds: [string, string, string]) {
    const [s1, s2, s3] = stepIds;

    if (action.type === "browser_navigate") {
      updatePlanStep(s1, "active");
      await delay(150);
      await invoke("open_url", { url: action.url });
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
      await invoke("open_application", { app: action.app });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(800);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_close_app") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invoke("close_application", { app: action.app });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(400);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_focus_window") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invoke("focus_window", { name: action.name });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(250);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_press_key") {
      updatePlanStep(s1, "active");
      await delay(100);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invoke("press_key", { keys: action.keys });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(120);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_type_text") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invoke("type_text", { text: action.text });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(150);
      updatePlanStep(s3, "done");

    } else if (action.type === "desktop_mouse_click") {
      updatePlanStep(s1, "active");
      await delay(150);
      updatePlanStep(s1, "done");

      updatePlanStep(s2, "active");
      await invoke("mouse_click", { x: action.x, y: action.y });
      updatePlanStep(s2, "done");

      updatePlanStep(s3, "active");
      await delay(150);
      updatePlanStep(s3, "done");
    }
  }

  async function executeDesktopActions(title: string, actions: DesktopAction[], summary?: string) {
    if (!(await ensureDesktopPermissions(actions))) return;

    // Expand every action into its 3 sub-checkpoints
    const expanded: { action: DesktopAction; steps: PlanStep[] }[] = actions.map((action) => ({
      action,
      steps: planStepsForAction(action),
    }));
    const allSteps: PlanStep[] = expanded.flatMap((e) => e.steps);

    setPlan({ title, topic: title, type: "desktop_task", steps: allSteps });
    addMessage({ role: "ai", text: title });
    trackActivity("command", title);

    try {
      for (const { action, steps } of expanded) {
        const ids: [string, string, string] = [steps[0].id, steps[1].id, steps[2].id];
        await runActionWithCheckpoints(action, ids);
        addActionLog({ ts: Date.now(), type: "os", label: describeDesktopAction(action).label });
      }
    } catch (err) {
      const idx = allSteps.findIndex((s) => s.status === "active");
      const errMsg = err instanceof Error ? err.message : String(err);
      if (idx >= 0) updatePlanStep(allSteps[idx].id, "error", errMsg);
      const spoken = `Sorry, something went wrong: ${errMsg}`;
      addMessage({ role: "ai", text: spoken });
      setResponse(spoken);
      setStatus("speaking");
      speak(spoken, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 4000); });
      return;
    }

    const finalMessage = summary ?? actions.map((a) => a.label).join(". ");
    setResponse(finalMessage);
    addMessage({ role: "ai", text: finalMessage });
    setStatus("speaking");
    trainBinaryBrain(transcript, actions.map((a) => a.label));
    // Keep dialog visible for 5s after the spoken summary so user sees all the green ticks.
    speak(finalMessage, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 5000); });
  }

  // Multi-step YouTube automation — every visible phase is a checkpoint.
  async function executeYouTubePlay(query: string) {
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

    setPlan({ title: `Playing: ${query}`, topic: query, type: "youtube_play", steps });
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
    setResponse(summary);
    addMessage({ role: "ai", text: summary });
    trainBinaryBrain(transcript, [`youtube:${query}`]);
    speak(summary, () => { setStatus("idle"); resumeWakeWord(); setTimeout(() => clearPlan(), 5000); });
  }

  // Execute a research plan step-by-step
  async function executeResearchPlan(
    topic: string,
    steps: Array<{ id: string; label: string; detail: string; url: string; delayMs: number }>,
  ) {
    if (!(await ensureBrowserPermission())) return;

    const planSteps: PlanStep[] = steps.map((s) => ({
      id: s.id,
      label: s.label,
      detail: s.detail,
      status: "pending",
    }));

    setPlan({ title: `Researching: ${topic}`, topic, type: "research", steps: planSteps });
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
      const attachments = pendingAttachmentsRef.current.splice(0);
      addMessage({ role: "user", text: transcript });
      setStatus("processing");
      const t0 = performance.now();

      try {
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
          const queryWithDocs = docContext ? `${docContext}\n\n${transcript}` : transcript;
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
            await executeDesktopActions(aiResult.label, [aiResult], aiResult.label);
          }
          return;
        }

        const result = await routeCommand(transcript);

        if (result.type === "command_chain") {
          const last = result.steps[result.steps.length - 1];
          const desktopSteps = result.steps.filter(isDesktopAction);

          if (desktopSteps.length === result.steps.length) {
            await executeDesktopActions(
              "Desktop task in progress",
              desktopSteps,
              desktopSteps.map((step) => step.label).join(". ")
            );

          } else if (last.type === "youtube_play") {
            addActionLog({ ts: Date.now(), type: "os", label: `YouTube: ${last.query}` });
            await executeYouTubePlay(last.query);

          } else if (last.type === "live_score") {
            await executeDesktopActions(
              `Opening live score for ${last.query}`,
              [{ type: "browser_navigate", url: last.url, label: `Opening live score for ${last.query}` }],
              `Opening live score for ${last.query}.`
            );

          } else if (last.type === "research") {
            trackActivity("research", last.topic);
            addActionLog({ ts: Date.now(), type: "research", label: `Researching: ${last.topic}` });
            await executeResearchPlan(last.topic, last.steps);

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
              await executeYouTubePlay(aiResult.query);
            } else if (isDesktopAction(aiResult)) {
              await executeDesktopActions(aiResult.label, [aiResult], aiResult.label);
            } else if (aiResult.type === "research") {
              await executeResearchPlan(aiResult.topic, aiResult.steps);
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
          await executeYouTubePlay(result.query);

        } else if (isDesktopAction(result)) {
          await executeDesktopActions(result.label, [result], result.label);

        } else if (result.type === "live_score") {
          await executeDesktopActions(
            `Opening live score for ${result.query}`,
            [{ type: "browser_navigate", url: result.url, label: `Opening live score for ${result.query}` }],
            `Opening live score for ${result.query}.`
          );

        } else if (result.type === "research") {
          trackActivity("research", result.topic);
          addActionLog({ ts: Date.now(), type: "research", label: `Researching: ${result.topic}` });
          await executeResearchPlan(result.topic, result.steps);

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
                desktopSubset.map((s) => s.label).join(". ")
              );
            } else {
              // Mixed (e.g. open app + youtube_play) → run sequentially
              for (const sub of aiResult.steps) {
                if (sub.type === "youtube_play") {
                  await executeYouTubePlay(sub.query);
                } else if (isDesktopAction(sub)) {
                  await executeDesktopActions(sub.label, [sub], sub.label);
                } else if (sub.type === "research") {
                  await executeResearchPlan(sub.topic, sub.steps);
                } else if (sub.type === "os_action") {
                  addMessage({ role: "ai", text: sub.message });
                }
              }
            }
          } else if (aiResult.type === "youtube_play") {
            await executeYouTubePlay(aiResult.query);
          } else if (isDesktopAction(aiResult)) {
            await executeDesktopActions(aiResult.label, [aiResult], aiResult.label);
          } else if (aiResult.type === "research") {
            await executeResearchPlan(aiResult.topic, aiResult.steps);
          } else {
            // os_action → spoken response
            const msg = aiResult.type === "os_action" ? aiResult.message : "Done.";
            addMessage({ role: "ai", text: msg, latencyMs });
            setResponse(msg);
            setStatus("speaking");
            speak(msg, () => { setStatus("idle"); resumeWakeWord(); });
          }
        }
      } catch (err) {
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
    setTranscript(text.trim() || "(attachment)");
    setStatus("listening");
  }

  return (
    <NovaChatInterface
      isHoldingSpace={isHoldingSpace}
      voiceSupported={voiceSupported || linuxVoiceAvailable === true}
      backgroundListening={backgroundListening}
      ollamaConnected={ollamaConnected}
      onSubmitText={submitText}
      onToggleBackgroundListening={toggleBackgroundListening}
      onClearChat={clearMessages}
      onResetSetup={resetSetup}
    />
  );
}

function App() {
  const { isSetupComplete } = useNovaStore();
  return isSetupComplete ? <NovaApp /> : <SetupWizard />;
}

export default App;
