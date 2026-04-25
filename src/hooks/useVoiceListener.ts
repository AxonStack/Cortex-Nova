import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNovaStore } from "../store/novaStore";

const WAKE_WORDS = ["chop chop cortex", "chop chop coretex"] as const;
const CONFIDENCE_THRESHOLD = 0.85;

interface SpeechRecognitionResult {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionAlternative {
  readonly [index: number]: SpeechRecognitionResult;
  readonly length: number;
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly [index: number]: SpeechRecognitionAlternative; readonly length: number };
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":         "Microphone access denied. Allow mic in browser address bar.",
  "audio-capture":       "No microphone found.",
  "network":             "Network error — Chrome needs internet for speech recognition.",
  "service-not-allowed": "Speech recognition blocked. Must be on localhost or HTTPS.",
  "no-speech":           "", // silent — no speech, just restart
  "aborted":             "", // silent — we caused this intentionally
};

export function useVoiceListener(backgroundListening: boolean) {
  const wakeRef  = useRef<SpeechRecognition | null>(null);
  const cmdRef   = useRef<SpeechRecognition | null>(null);
  const modeRef  = useRef<"wake" | "command" | "off">("off");
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const { setStatus, setTranscript, showOverlay, setError, hideOverlay } = useNovaStore();

  // ── Check if this platform supports Speech API ────────────────────────
  useEffect(() => {
    invoke<boolean>("speech_api_supported")
      .then((ok) => setVoiceSupported(ok && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)))
      .catch(()  => setVoiceSupported(!!(window.SpeechRecognition ?? window.webkitSpeechRecognition)));
  }, []);

  const getSR = (): (new () => SpeechRecognition) | null =>
    window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;

  // ── Wake word listener ────────────────────────────────────────────────
  const startWakeWord = useCallback(() => {
    const SR = getSR();
    if (!SR || modeRef.current !== "wake" || wakeRef.current) return;

    const r = new SR();
    wakeRef.current = r;
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = "en-US";
    r.maxAlternatives = 1;

    r.onresult = (e: SpeechRecognitionEvent) => {
      if (modeRef.current !== "wake") return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.toLowerCase().trim();
        const conf = e.results[i][0].confidence;
        const isFinal = conf > 0;
        const hasWakeWord = WAKE_WORDS.some((wakeWord) => text.includes(wakeWord));
        const hit = (isFinal && hasWakeWord && conf >= CONFIDENCE_THRESHOLD)
                 || (!isFinal && hasWakeWord);
        if (hit) {
          modeRef.current = "command";
          wakeRef.current = null;
          r.abort();
          setTranscript("");
          showOverlay();
          // Bring the window to front so the user sees it activate
          try { void getCurrentWindow().setFocus(); } catch { /* not in Tauri */ }
          restartRef.current = setTimeout(() => startCommand(), 150);
          return;
        }
      }
    };

    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      wakeRef.current = null;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        const msg = ERROR_MESSAGES[e.error] ?? "Speech recognition is blocked.";
        if (msg) setError(msg);
        modeRef.current = "off";
        return;
      }
      // All other errors: silently restart after a short pause
      if (modeRef.current === "wake") {
        restartRef.current = setTimeout(() => startWakeWord(), 800);
      }
    };

    r.onend = () => {
      wakeRef.current = null;
      // Chrome stops continuous recognition every ~60s — restart with minimal delay
      if (modeRef.current === "wake") {
        restartRef.current = setTimeout(() => startWakeWord(), 200);
      }
    };

    try { r.start(); } catch { /* ignore if already started */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlay, setError, setTranscript]);

  // ── Command listener ──────────────────────────────────────────────────
  const startCommand = useCallback((mode: "single" | "hold" = "single") => {
    const SR = getSR();
    if (!SR) return;

    const r = new SR();
    cmdRef.current = r;
    r.continuous     = mode === "hold";
    r.interimResults = true;
    r.lang           = "en-US";

    setStatus("listening");

    r.onresult = (e: SpeechRecognitionEvent) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        t += e.results[i][0].transcript;
      }
      setTranscript(t.trim());
    };

    r.onend = () => {
      cmdRef.current = null;
      // transcript is set — App.tsx useEffect picks it up
    };

    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      cmdRef.current = null;
      const msg = ERROR_MESSAGES[e.error] ?? `Speech error: ${e.error}`;
      if (msg) setError(msg);
      else if (e.error !== "aborted") hideOverlay();
    };

    try { r.start(); } catch { setError("Could not start microphone."); }
  }, [setStatus, setTranscript, setError, hideOverlay]);

  // ── Public: trigger command from Space key ────────────────────────────
  const startCommandListening = useCallback((mode: "single" | "hold" = "single") => {
    // Stop wake word recognition first
    if (wakeRef.current) {
      wakeRef.current.abort();
      wakeRef.current = null;
    }
    modeRef.current = "command";

    // Wait for Chrome to release the mic before starting a new session
    restartRef.current = setTimeout(() => startCommand(mode), 150);
  }, [startCommand]);

  // ── Public: stop command session (used for push-to-talk key release) ──
  const stopCommandListening = useCallback(() => {
    if (restartRef.current) {
      clearTimeout(restartRef.current);
      restartRef.current = null;
    }
    if (cmdRef.current) {
      cmdRef.current.abort();
      cmdRef.current = null;
    }
    modeRef.current = "off";
  }, []);

  // ── Public: resume wake word after overlay closes ─────────────────────
  const resumeWakeWord = useCallback(() => {
    // Stop any ongoing command session
    if (cmdRef.current) {
      cmdRef.current.abort();
      cmdRef.current = null;
    }
    if (restartRef.current) {
      clearTimeout(restartRef.current);
      restartRef.current = null;
    }
    if (!backgroundListening) {
      modeRef.current = "off";
      return;
    }
    modeRef.current = "wake";
    // Small delay so Chrome fully releases mic from command session
    restartRef.current = setTimeout(() => startWakeWord(), 200);
  }, [backgroundListening, startWakeWord]);

  // ── Public: stop everything ───────────────────────────────────────────
  const stopAll = useCallback(() => {
    modeRef.current = "off";
    if (restartRef.current) { clearTimeout(restartRef.current); restartRef.current = null; }
    wakeRef.current?.abort();
    wakeRef.current = null;
    cmdRef.current?.abort();
    cmdRef.current = null;
  }, []);

  // ── Boot ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (voiceSupported !== true || !backgroundListening) {
      stopAll();
      return;
    }
    modeRef.current = "wake";
    startWakeWord();
    return () => stopAll();
  }, [voiceSupported, backgroundListening, startWakeWord, stopAll]);

  return { voiceSupported, startCommandListening, stopCommandListening, resumeWakeWord, stopAll };
}
