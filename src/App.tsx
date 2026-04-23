import { useEffect, useRef, useState } from "react";
import { NovaChatInterface } from "./components/NovaOverlay";
import { SetupWizard } from "./components/SetupWizard";
import { useVoiceListener } from "./hooks/useVoiceListener";
import { useNovaStore } from "./store/novaStore";
import { routeCommand } from "./lib/commandRouter";
import { askAI } from "./lib/providerClient";
import { speak } from "./lib/speechSynthesis";

function NovaApp() {
  const { voiceSupported, startCommandListening, stopCommandListening, resumeWakeWord } = useVoiceListener();
  const [isHoldingSpace, setIsHoldingSpace] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const holdSpaceRef = useRef(false);

  const {
    status, transcript, providerConfig,
    setStatus, setTranscript, setResponse,
    addMessage, clearMessages, resetSetup, theme,
  } = useNovaStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Check Ollama connection
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

  // Process transcript once speech stops and there's content
  useEffect(() => {
    if (status !== "listening" || !transcript.trim() || isHoldingSpace) return;

    const handle = async () => {
      addMessage({ role: "user", text: transcript });
      setStatus("processing");
      try {
        const result = await routeCommand(transcript);
        if (result.type === "os_action") {
          addMessage({ role: "ai", text: result.message });
          setResponse(result.message);
          setStatus("speaking");
          speak(result.message, () => setStatus("idle"));
        } else {
          const aiResponse = await askAI(result.query, providerConfig);
          addMessage({ role: "ai", text: aiResponse });
          setResponse(aiResponse);
          setStatus("speaking");
          speak(aiResponse, () => setStatus("idle"));
        }
      } catch (err) {
        useNovaStore.getState().setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    };

    const t = setTimeout(handle, 600);
    return () => clearTimeout(t);
  }, [transcript, status, isHoldingSpace, providerConfig, setStatus, setResponse, addMessage]);

  // Spacebar hold-to-talk
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (voiceSupported && !e.repeat && !holdSpaceRef.current) {
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
      // If nothing was spoken, just reset status
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
  }, [voiceSupported, startCommandListening, stopCommandListening, resumeWakeWord, setTranscript, setResponse, setStatus]);

  function submitText(text: string) {
    if (!text.trim()) return;
    setTranscript(text.trim());
    setStatus("listening");
  }

  return (
    <NovaChatInterface
      isHoldingSpace={isHoldingSpace}
      voiceSupported={voiceSupported}
      ollamaConnected={ollamaConnected}
      onSubmitText={submitText}
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
