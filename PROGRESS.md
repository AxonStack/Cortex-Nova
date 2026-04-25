# Nova Voice Assistant — Build Progress

## Direct Install (Users)

```bash
curl -fsSL https://raw.githubusercontent.com/AxonStack/Cortex-Nova/main/install.sh | bash
```

---

## Environment Setup

### Rust Installation
- **Version:** rustc 1.95.0 (59807616e 2026-04-14)
- **Cargo:** 1.95.0
- **Installed via:** `rustup` (non-interactive, stable toolchain)
- **Path:** `$HOME/.cargo/env` sourced into shell

### System Dependencies (Ubuntu/Debian)
Installed for Tauri 2:
- `libwebkit2gtk-4.1-dev`
- `build-essential`
- `libssl-dev`
- `libayatana-appindicator3-dev`
- `librsvg2-dev`

### Node.js / Package Manager
- Node.js: v24.13.0
- npm: 11.6.2
- pnpm: 10.33.1 (installed globally)

---

## Project Bootstrap

### Tauri App Created
```bash
npm create tauri-app@latest nova -- --template react-ts --manager pnpm --yes
```
- Template: `react-ts`
- Location: `/home/azureuser/bluntwork/cortex-nova/nova/`

### Dependencies Installed
| Package | Version | Purpose |
|---|---|---|
| tailwindcss | 4.2.4 | Utility CSS |
| @tailwindcss/vite | 4.2.4 | Vite plugin for Tailwind v4 |
| framer-motion | 12.38.0 | Animations (waveform, overlay transitions) |
| zustand | 5.0.12 | Global state management |
| @anthropic-ai/sdk | 0.90.0 | Claude API client |
| @tauri-apps/api | 2.10.1 | Tauri JS bridge |
| @tauri-apps/plugin-opener | 2.5.3 | Open URLs / files from Tauri |

---

## Files Created / Modified

### New Files
| File | Purpose |
|---|---|
| `src/tailwind.css` | Tailwind v4 entrypoint (`@import "tailwindcss"`) |
| `src/store/novaStore.ts` | Zustand store: status, transcript, response, overlay state |
| `src/hooks/useVoiceListener.ts` | Wake word detection + command listening via Web Speech API |
| `src/lib/commandRouter.ts` | Routes voice commands to OS actions or Claude AI |
| `src/lib/claudeClient.ts` | Anthropic SDK wrapper — asks Claude claude-sonnet-4-6 |
| `src/lib/speechSynthesis.ts` | Text-to-speech via Web Speech Synthesis API |
| `src/components/WaveformAnimation.tsx` | Animated waveform bars (Framer Motion) |
| `src/components/StatusIndicator.tsx` | Shows current Nova status with animated dot |
| `src/components/NovaOverlay.tsx` | Glassmorphism floating overlay panel |
| `CLAUDE.md` | Project instructions for Claude Code sessions |
| `.claudeignore` | Protects .env, target/, locks from Claude context |
| `.env.example` | Template for `VITE_ANTHROPIC_API_KEY` |

### Modified Files
| File | Change |
|---|---|
| `vite.config.ts` | Added `@tailwindcss/vite` plugin |
| `src/main.tsx` | Added `tailwind.css` import |
| `src/App.tsx` | Full rewrite — wires voice listener, command router, overlay |
| `src-tauri/tauri.conf.json` | Updated window title, added transparent + opener plugin config |

---

## Architecture

```
User speaks "Hey Nova"
       │
       ▼
useVoiceListener (continuous SpeechRecognition)
  Confidence threshold: >= 0.85
       │
       ▼ (wake word detected)
showOverlay() → NovaOverlay appears
startCommandListening() → new SpeechRecognition session
       │
       ▼ (command captured)
routeCommand(transcript)
  ├── OS Pattern match → openUrl() via Tauri opener plugin
  │     └── speak(result) → TTS → hideOverlay()
  └── No match → askClaude(query)
        └── Claude claude-sonnet-4-6 response → speak() → hideOverlay()
```

### State Machine (novaStore)
```
idle → listening → processing → speaking → [back to idle/hidden]
                             └→ error
```

---

## Build Status — Phase 1
- TypeScript: PASS (strict mode, no errors)
- Vite build: PASS (503 modules, 412KB JS bundle)
- Rust: Not built yet (requires Tauri CLI with Rust in PATH for full `pnpm tauri build`)

---

## Phase 2 — Provider Setup Wizard (2026-04-23)

### Problem
Running `pnpm tauri dev` on a headless Azure VM causes `Failed to initialize gtk backend` — Tauri is a desktop app that requires a display server (X11/Wayland). The app must be run on a machine with a screen, or using Xvfb for testing.

### Added: Multi-Provider AI Support

**New dependency:** `openai@6.34.0`

**New/modified files:**

| File | Change |
|---|---|
| `src/store/novaStore.ts` | Added `ProviderConfig` type + Zustand `persist` middleware — config saved to localStorage |
| `src/lib/providerClient.ts` | Unified AI client — routes to Anthropic SDK / OpenAI SDK / Ollama REST based on config |
| `src/components/SetupWizard.tsx` | First-launch wizard — pick Ollama, Anthropic, or OpenAI; configure model/key |
| `src/App.tsx` | Shows `SetupWizard` if `isSetupComplete` is false, otherwise shows `NovaApp` |

### Provider Config Shape
```ts
{
  provider: "ollama" | "anthropic" | "openai",
  apiKey: string,          // empty for ollama
  ollamaModel: string,     // e.g. "llama3.2"
  ollamaUrl: string,       // e.g. "http://localhost:11434"
}
```
Config persisted to localStorage under key `nova-config`.

### Build Status — Phase 2
- TypeScript: PASS
- Vite build: PASS (621 modules, 532KB JS bundle)

---

## Next Steps
1. Run on a machine with a display (or use Xvfb): `source ~/.cargo/env && pnpm tauri dev`
2. Setup wizard appears on first launch — pick your provider
3. Say "Hey Nova" to activate

---

## Known Limitations
- Web Speech API only available in Chromium-based WebView (works in Tauri on Linux/macOS/Windows)
- Confidence scores for interim speech results are 0 — wake word falls back to text match
- API keys stored in browser localStorage — acceptable for desktop, not for web deployment
- GTK error on headless servers: use Xvfb or run on a machine with a display
