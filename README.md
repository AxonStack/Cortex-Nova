# Cortex Nova — AI Voice Assistant

A Jarvis-style always-on desktop assistant. Say the wake word and Nova activates, listens, acts — opening apps, searching the web, composing emails, typing for you, playing music, and answering anything with AI. Between commands it goes back to listening in the background, invisible until you need it.

---

## Install (End Users)

```bash
curl -fsSL https://raw.githubusercontent.com/AxonStack/Cortex-Nova/main/install.sh | bash
```

This installs the latest release package for your Linux system (`.deb` when available, otherwise AppImage) and registers the desktop app icon.

---

## What It Can Do

| You say | Nova does |
|---|---|
| "chop chop cortex, open YouTube" | Opens youtube.com in your browser |
| "play Bohemian Rhapsody" | Searches YouTube and plays it |
| "play Blinding Lights on Spotify" | Opens Spotify search |
| "search for Rust async tutorials" | Google search in browser |
| "search YouTube for lo-fi beats" | YouTube search |
| "email john about the standup saying I'll be 5 minutes late" | Opens Gmail compose with subject + body pre-filled |
| "go to github.com" | Navigates to any URL |
| "open Discord" | Opens discord.com/app |
| "type hello world" | Types the text into whatever app is focused |
| "click at 500 300" | Moves the mouse and left-clicks at screen position |
| "remember that my API key expires on June 1st" | Stores to persistent memory |
| "what do you remember about API keys" | Recalls from memory with concept matching |
| "forget about API keys" | Deletes matching memories |
| "what's the capital of France?" | AI answers, Nova speaks it |
| "explain how neural networks work" | AI answers with memory context injected |

Anything not recognised as an OS command goes to your AI provider, with relevant memories automatically injected as context.

---

## Permission-Gated Automation

Nova now gates desktop control behind explicit user permissions.

1. When Nova needs a missing permission during a task, it asks for approval first.
2. If you approve, Nova continues the task immediately.
3. You can manage permissions manually in the in-app **PERMS** tab.
4. Permission prompts use native Tauri dialog windows (Allow/Deny).

Permission scopes:
- `desktopAutomation` (master switch)
- `appControl` (open/close applications)
- `browserControl` (navigation + browser task flows)
- `keyboardMouseControl` (typing, keypresses, mouse clicks)

---

## Background Mode — Always Listening

Nova is designed as a background application. The wake word detector runs continuously — you don't need to click anything.

**Wake phrase:** `"chop chop cortex"`

1. App starts → wake word listener activates immediately
2. You say "chop chop cortex" from anywhere on your desktop
3. Nova's window comes to the foreground, mic switches to command mode
4. Speak your command — Nova listens until silence
5. Nova acts, speaks the response, returns to background listening

For true system-tray background mode (hide window, run in tray), see [Roadmap](#roadmap).

---

## Binary Memory Language Map

Nova has a persistent memory system stored locally. It uses a concept-entanglement architecture:

### Storage Format
Memories are serialised to JSON then Base64-encoded before writing to `localStorage` under the key `cnova:mem`. The "binary" envelope means the raw storage is opaque and compact.

### Memory Language Map
Every memory is tagged with concept tokens extracted from the text (stop words removed, deduplicated). These tags are stored in a **concept co-occurrence graph** — the Language Map:

```
map: {
  "api": { "key": 3, "expires": 2, "authentication": 1 },
  "key": { "api": 3, "expires": 2 },
  "expires": { "api": 2, "key": 2, "june": 1 }
}
```

### Entanglement — How Recall Works
When you say *"recall API keys"*, Nova:
1. Extracts concept tags from your query (`["api", "keys"]`)
2. Expands via the language map — `api` is linked to `key`, `expires`, `authentication`
3. Scores every stored memory by how many expanded tags it contains, weighted by importance
4. Returns the top matches — even if they don't contain your exact words

This means memories are **entangled** through shared concepts. Asking about "authentication" surfaces memories about "API keys" because they co-occur in the concept graph.

### Voice Commands
| Command | Effect |
|---|---|
| `remember that [fact]` | Stores with importance 0.8 |
| `recall [topic]` | Top 4 matches from concept search |
| `what do you remember about [topic]` | Same as recall |
| `forget [topic]` | Deletes all memories matching the concept |

### Memory Context in AI
When you ask Nova a question, relevant memories are automatically prepended to the AI prompt:
```
[Memory context]
- My API key expires on June 1st
- I prefer TypeScript over JavaScript

[Query]
What should I put in my .env file?
```
The AI uses this context to give personalised answers without you having to repeat yourself.

---

## System Automation

Nova can control your desktop with native Tauri commands:
- open/close applications
- open URLs in browser
- focus windows
- press key combinations
- type text
- move + click mouse

For broad instructions (`open X then do Y`), Nova now uses a dynamic AI planner that emits executable action chains instead of relying only on hardcoded regex routes.

---

## Binary Coprocessor + Main AI Brain

Nova now has two cooperating layers:
- Main AI planner: interprets natural language and builds action plans.
- Binary coprocessor: lightweight local learner that tracks successful intent patterns and injects compact context hints into planner prompts.

The binary coprocessor is local-first and incremental. It does not replace the main LLM; it improves consistency for your repeated workflows over time. You can enable/disable it in the in-app **BRAIN** tab.

`BRAIN` tab controls:
- Export training state
- Import training state
- Reset training state

---

## AI Providers

Pick one on first launch. Change at any time with the **SETUP** button.

| Provider | Model | Cost | Privacy |
|---|---|---|---|
| **Ollama** (default) | llama3.2, mistral, phi4, etc. | Free | 100% local |
| **Anthropic** | claude-sonnet-4-6 | Pay-per-use | Cloud |
| **OpenAI** | GPT-4o | Pay-per-use | Cloud |

### Ollama Setup
```bash
ollama serve               # start the local server
ollama pull llama3.2       # download the model (once, ~2 GB)
```

---

## Theme

Press `◑ DARK` / `☀ LIGHT` in the top-right to toggle. Theme is persisted to localStorage.

---

## Command Reference

| Pattern | Category |
|---|---|
| `remember [that] ...` | Memory write |
| `recall / what do you remember about ...` | Memory read |
| `forget [about] ...` | Memory delete |
| `type ...` | System typing |
| `click at X Y` | Mouse click |
| `play ... [on youtube/spotify]` | Media |
| `search [for] ...` | Web search (Google) |
| `search youtube for ...` | YouTube search |
| `open / go to / launch / run ...` | Dynamic AI-planned desktop flow |
| `email ...` | Dynamic AI-planned compose flow |
| Hold `SPACE` | Push-to-talk voice input |
| Anything else | → AI query / planner with memory + binary context |

**Note:** common media/search/memory commands remain fast-path routed; broader desktop tasks are AI-planned dynamically.

---

## Prerequisites

```bash
# Rust
source ~/.cargo/env
rustc --version   # 1.95.0+

# Node.js 18+
node --version

# pnpm
pnpm --version

# Linux: system libs
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev
```

---

## Running the App

From source (developer setup):

### Local machine (macOS / Windows / Linux desktop)
```bash
pnpm install
source ~/.cargo/env
pnpm tauri dev
```

### Headless Linux server (Azure VM, VPS)
```bash
pnpm xvfb:start       # start virtual display on :99
source ~/.cargo/env
pnpm tauri:dev
```

The first Rust compile takes 2–5 minutes. Subsequent runs use cache.

---

## Project Structure

```
cortex-nova/
├── src/
│   ├── App.tsx                     # Root — SetupWizard or main chat
│   ├── components/
│   │   ├── NovaOverlay.tsx         # Permanent chat interface (NovaChatInterface)
│   │   ├── SetupWizard.tsx         # First-launch provider picker
│   │   ├── WaveformAnimation.tsx   # Animated bars during listen/speak
│   │   └── StatusIndicator.tsx     # Status label
│   ├── hooks/
│   │   └── useVoiceListener.ts     # Wake word + command recognition + window focus
│   ├── lib/
│   │   ├── commandRouter.ts        # Fast-path command routing + AI fallback
│   │   ├── memory.ts               # Binary Memory Language Map
│   │   ├── binaryBrain.ts          # Local binary coprocessor learning hints
│   │   ├── providerClient.ts       # AI planner + provider clients
│   │   └── speechSynthesis.ts      # Text-to-speech
│   └── store/
│       └── novaStore.ts            # Zustand (voice state + permissions + brain + config)
├── src-tauri/
│   └── src/lib.rs                  # Rust desktop automation commands
├── CLAUDE.md                       # Claude Code session instructions
└── README.md                       # This file
```

---

## Stack

| Technology | Role |
|---|---|
| Tauri 2 (Rust) | Desktop shell, native automation (open/focus/type/key/click) |
| React 19 + TypeScript strict | Frontend UI |
| Tailwind CSS v4 | Styling with dark/light theme |
| Zustand 5 | Global state (persisted to localStorage) |
| Web Speech API | Wake word detection + command recognition + TTS |
| Anthropic SDK | Claude claude-sonnet-4-6 |
| OpenAI SDK | GPT-4o |
| Ollama REST | Free local AI |
| Enigo + native OS commands | Cross-platform system input automation |

---

## Troubleshooting

### Wake word not triggering
- Say **"chop chop cortex"** clearly — the phrase needs to be confident
- Check microphone permissions in your OS
- On Linux: Web Speech API is not available in WebKitGTK — voice runs in the host browser if you use `pnpm dev` in a real browser

### Desktop actions are denied
- Open the in-app **PERMS** tab
- Enable `Desktop Automation` and required scopes (`App`, `Browser`, `Keyboard/Mouse`)
- Retry the same command

### Ollama not connecting
```bash
ollama serve
ollama list          # check model is downloaded
ollama pull llama3.2
```

### Memory not persisting
Memory is stored in `localStorage` under `cnova:mem`. Clear only clears the current session messages — stored memories survive. Use `forget [topic]` to delete specific memories, or clear `cnova:mem` in DevTools to reset everything.

### First build is slow
Normal — Rust compiles from scratch (~2–5 min). Subsequent builds use cache (~15 sec).

---

## Roadmap

- [ ] System tray icon — hide window, keep wake word running in background
- [ ] Auto-start on login (OS startup entry via Tauri)
- [ ] Screen capture + AI vision for click-by-description ("click the Send button")
- [x] Dynamic multi-step AI planner for desktop action chains
- [ ] Memory importance decay — old low-weight memories fade over time
- [ ] Per-app launcher discovery cache to improve obscure app opening reliability
- [x] Per-app launcher discovery cache (Linux `.desktop` IDs) for better app launch matching
- [ ] Memory export/import (JSON file)
- [ ] Per-provider conversation history (multi-turn context)
- [ ] Plugin system for custom command handlers
