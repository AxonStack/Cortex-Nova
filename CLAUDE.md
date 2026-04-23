# Nova — AI Voice Assistant

## Stack
- Tauri 2 (Rust backend + React frontend)
- TypeScript strict mode + Rust 1.95
- Tailwind CSS v4 (via @tailwindcss/vite)
- Zustand (global state)
- Framer Motion (animations)
- Web Speech API (voice input + synthesis)
- Anthropic Claude claude-sonnet-4-6 (AI brain)

## Architecture
- Wake word detection: `useVoiceListener` hook — continuous SpeechRecognition, triggers on "Hey Nova" with confidence >= 0.85
- Command routing: `commandRouter.ts` — regex-based OS action patterns, falls through to Claude API for unrecognized commands
- AI: `claudeClient.ts` — claude-sonnet-4-6 via Anthropic SDK, browser-safe, concise voice-optimized system prompt
- TTS: `speechSynthesis.ts` — Web Speech Synthesis API
- UI: `NovaOverlay.tsx` — glassmorphism floating panel, AnimatePresence transitions
- State: `novaStore.ts` (Zustand) — status, transcript, response, overlay visibility

## File Structure
- `src/components/` — UI components (NovaOverlay, WaveformAnimation, StatusIndicator)
- `src/hooks/` — useVoiceListener
- `src/store/` — Zustand store (novaStore.ts)
- `src/lib/` — commandRouter, claudeClient, speechSynthesis
- `src-tauri/src/` — Rust backend (lib.rs, main.rs)

## Coding Rules
- Always create a git branch before making changes: `git checkout -b feature/<name>`
- TypeScript strict mode — no `any` types
- Named exports only — no default exports except App
- All components must be functional
- Rust functions must have doc comments
- Run `pnpm build` before considering a task complete for frontend

## Environment
- `VITE_ANTHROPIC_API_KEY` — required for Claude AI responses. Set in `.env`

## Do NOT
- Commit `.env` files
- Modify `src-tauri/target/` directly
- Install new dependencies without noting them in the response
- Use `any` types in TypeScript
