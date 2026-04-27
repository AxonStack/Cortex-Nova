import { useEffect, useRef, useState } from "react";
import { NovaChatInterface } from "./components/NovaOverlay";
import { SetupWizard } from "./components/SetupWizard";
import { useVoiceListener } from "./hooks/useVoiceListener";
import { useNovaStore } from "./store/novaStore";
import type { PlanStep } from "./store/novaStore";
import { invoke } from "@tauri-apps/api/core";
import { routeCommand, openUrl } from "./lib/commandRouter";
import { askAI } from "./lib/providerClient";
import { speak } from "./lib/speechSynthesis";
import { trackActivity } from "./lib/memory";
import { closeTaskDialog, showTaskDialog } from "./lib/taskDialogWindow";

function NovaApp() {
  const [isHoldingSpace, setIsHoldingSpace] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const holdSpaceRef = useRef(false);

  const {
    status, transcript, providerConfig,
    setStatus, setTranscript, setResponse,
    addMessage, clearMessages, resetSetup, theme,
    addActionLog, setPlan, updatePlanStep, clearPlan,
    backgroundListening, setBackgroundListening, setError, activePlan,
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

  // Automate Chrome to search and play on YouTube
  async function executeYouTubePlay(query: string) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const steps: PlanStep[] = [
      { id: crypto.randomUUID(), label: "Opening Chrome",          detail: "Launching Chrome browser",           status: "pending" },
      { id: crypto.randomUUID(), label: "Focusing Chrome window",  detail: "Bringing Chrome to the foreground",   status: "pending" },
      { id: crypto.randomUUID(), label: "Opening address bar",     detail: "Ctrl+L — focusing URL bar",           status: "pending" },
      { id: crypto.randomUUID(), label: "Typing YouTube search",   detail: searchUrl,                             status: "pending" },
      { id: crypto.randomUUID(), label: "Loading results",         detail: "Waiting for YouTube search results",  status: "pending" },
      { id: crypto.randomUUID(), label: "Clicking first result",   detail: `Playing "${query}"`,                  status: "pending" },
    ];

    setPlan({ title: `Playing: ${query}`, topic: query, type: "youtube_play", steps });
    addMessage({ role: "ai", text: `Opening Chrome and using YouTube to play "${query}".` });
    trackActivity("command", `youtube:${query}`);

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const step = (i: number, status: PlanStep["status"]) => updatePlanStep(steps[i].id, status);

    try {
      // 1. Launch Chrome
      step(0, "active");
      await invoke("launch_browser");
      await delay(1200);
      step(0, "done");

      // 2. Focus Chrome window
      step(1, "active");
      await invoke("focus_window", { name: "Google Chrome" }).catch(() =>
        invoke("focus_window", { name: "Chromium" }).catch(() => {})
      );
      await delay(500);
      step(1, "done");

      // 3. Click address bar (Ctrl+L)
      step(2, "active");
      await invoke("press_key", { keys: "ctrl+l" });
      await delay(400);
      step(2, "done");

      // 4. Type the search URL
      step(3, "active");
      await invoke("type_text", { text: searchUrl });
      await delay(300);
      await invoke("press_key", { keys: "Return" });
      step(3, "done");

      // 5. Wait for page to load
      step(4, "active");
      await delay(2800);
      step(4, "done");

      // 6. Tab to first video result and press Enter
      step(5, "active");
      for (let i = 0; i < 7; i++) {
        await invoke("press_key", { keys: "Tab" });
        await delay(80);
      }
      await invoke("press_key", { keys: "Return" });
      step(5, "done");
    } catch (err) {
      const i = steps.findIndex((s) => s.status === "active");
      if (i >= 0) updatePlanStep(steps[i].id, "error", String(err));
      throw new Error(
        err instanceof Error
          ? `YouTube automation failed: ${err.message}`
          : `YouTube automation failed: ${String(err)}`
      );
    }

    setStatus("speaking");
    const summary = `Now playing "${query}" on YouTube.`;
    setResponse(summary);
    addMessage({ role: "ai", text: summary });
    speak(summary, () => {
      setStatus("idle");
      resumeWakeWord();
      setTimeout(() => clearPlan(), 4000);
    });
  }

  // Execute a research plan step-by-step
  async function executeResearchPlan(
    topic: string,
    steps: Array<{ id: string; label: string; detail: string; url: string; delayMs: number }>,
  ) {
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
      addMessage({ role: "user", text: transcript });
      setStatus("processing");
      const t0 = performance.now();

      try {
        const result = await routeCommand(transcript);

        if (result.type === "command_chain") {
          const leadMessages = result.steps
            .slice(0, -1)
            .filter((step): step is Extract<typeof step, { type: "os_action" }> => step.type === "os_action")
            .map((step) => step.message);
          const last = result.steps[result.steps.length - 1];

          if (leadMessages.length) {
            const preface = leadMessages.join(". ");
            const latencyMs = Math.round(performance.now() - t0);
            trackActivity("command", preface);
            addActionLog({ ts: Date.now(), type: "os", label: preface, latencyMs });
          }

          if (last.type === "youtube_play") {
            addActionLog({ ts: Date.now(), type: "os", label: `YouTube: ${last.query}` });
            await executeYouTubePlay(last.query);

          } else if (last.type === "live_score") {
            await openUrl(last.url);
            const message = `Opening live score for ${last.query}.`;
            addActionLog({ ts: Date.now(), type: "research", label: message });
            addMessage({ role: "ai", text: message });
            setResponse(message);
            setStatus("speaking");
            speak(message, () => {
              setStatus("idle");
              resumeWakeWord();
            });

          } else if (last.type === "research") {
            trackActivity("research", last.topic);
            addActionLog({ ts: Date.now(), type: "research", label: `Researching: ${last.topic}` });
            await executeResearchPlan(last.topic, last.steps);

          } else if (last.type === "os_action") {
            const message = [...leadMessages, last.message].join(". ");
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
            const aiResponse = await askAI(last.query, providerConfig);
            const latencyMs = Math.round(performance.now() - t0);
            addActionLog({ ts: Date.now(), type: "ai", label: last.query, latencyMs });
            addMessage({ role: "ai", text: aiResponse, latencyMs });
            setResponse(aiResponse);
            setStatus("speaking");
            speak(aiResponse, () => {
              setStatus("idle");
              resumeWakeWord();
            });
          } else {
            throw new Error("Nested command chains are not supported.");
          }

        } else if (result.type === "youtube_play") {
          addActionLog({ ts: Date.now(), type: "os", label: `YouTube: ${result.query}` });
          await executeYouTubePlay(result.query);

        } else if (result.type === "live_score") {
          await openUrl(result.url);
          const message = `Opening live score for ${result.query}.`;
          addActionLog({ ts: Date.now(), type: "research", label: message });
          addMessage({ role: "ai", text: message });
          setResponse(message);
          setStatus("speaking");
          speak(message, () => {
            setStatus("idle");
            resumeWakeWord();
          });

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
          trackActivity("ai", result.query);
          const aiResponse = await askAI(result.query, providerConfig);
          const latencyMs = Math.round(performance.now() - t0);
          addActionLog({ ts: Date.now(), type: "ai", label: result.query, latencyMs });
          addMessage({ role: "ai", text: aiResponse, latencyMs });
          setResponse(aiResponse);
          setStatus("speaking");
          speak(aiResponse, () => {
            setStatus("idle");
            resumeWakeWord();
          });
        }
      } catch (err) {
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

  function submitText(text: string) {
    if (!text.trim()) return;
    setTranscript(text.trim());
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
