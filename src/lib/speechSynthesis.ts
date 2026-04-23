export function speak(text: string, onEnd?: () => void): void {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.lang = "en-US";

  // Prefer a natural-sounding voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.lang === "en-US" && (v.name.includes("Natural") || v.name.includes("Samantha") || v.name.includes("Google"))
  );
  if (preferred) utterance.voice = preferred;

  if (onEnd) utterance.onend = onEnd;

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
}
