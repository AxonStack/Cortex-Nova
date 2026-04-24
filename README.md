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

Nova can control your desktop — type text, move the mouse, click.

### Typing (`type [text]`)
Sends keystrokes to whatever application currently has focus.

| Platform | Backend |
|---|---|
| Linux | `xdotool type --clearmodifiers` |
| macOS | `osascript` System Events keystroke |
| Windows | PowerShell `WScript.Shell.SendKeys` |

**Linux prerequisite:** `sudo apt install xdotool`

Example: "type my name is nova" → Nova types that string into your focused text field.

### Mouse Click (`click at X Y`)
Moves the cursor to absolute screen coordinates and left-clicks.

Example: "click at 960 540" → clicks the centre of a 1920×1080 screen.

### Planned Automation
Future versions will chain these primitives with AI vision to complete full browser tasks:
- "Search YouTube for lo-fi and click the first result"
- "Open Gmail, find the email from John, and reply with 'on my way'"

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
| `open [site]` | Open shorthand URL |
| `go to [url/site]` | Navigate |
| `email [person] about [subject] saying [body]` | Gmail compose |
| Hold `SPACE` | Push-to-talk voice input |
| Anything else | → AI query (with memory context) |

**Built-in sites:** YouTube, Gmail, GitHub, Twitter, Reddit, Spotify, Netflix, Google, LinkedIn, Instagram, Discord, Notion, ChatGPT

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

# Linux: system libs + automation tools
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev xdotool
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
│   │   ├── commandRouter.ts        # Pattern matching → OS actions or AI query
│   │   ├── memory.ts               # Binary Memory Language Map
│   │   ├── providerClient.ts       # AI provider client (memory context injection)
│   │   └── speechSynthesis.ts      # Text-to-speech
│   └── store/
│       └── novaStore.ts            # Zustand (voice state + config + theme, persisted)
├── src-tauri/
│   └── src/lib.rs                  # Rust: open_url, type_text, mouse_click, speech_api_supported
├── CLAUDE.md                       # Claude Code session instructions
└── README.md                       # This file
```

---

## Stack

| Technology | Role |
|---|---|
| Tauri 2 (Rust) | Desktop shell, system commands (open_url, type_text, mouse_click) |
| React 19 + TypeScript strict | Frontend UI |
| Tailwind CSS v4 | Styling with dark/light theme |
| Zustand 5 | Global state (persisted to localStorage) |
| Web Speech API | Wake word detection + command recognition + TTS |
| Anthropic SDK | Claude claude-sonnet-4-6 |
| OpenAI SDK | GPT-4o |
| Ollama REST | Free local AI |
| xdotool / osascript / PowerShell | Cross-platform system input automation |

---

## Troubleshooting

### Wake word not triggering
- Say **"chop chop cortex"** clearly — the phrase needs to be confident
- Check microphone permissions in your OS
- On Linux: Web Speech API is not available in WebKitGTK — voice runs in the host browser if you use `pnpm dev` in a real browser

### `type` command does nothing
- Linux: install xdotool — `sudo apt install xdotool`
- Make sure the target application window is focused before speaking

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
- [ ] Multi-step task chains ("open YouTube, search X, click the first result, skip the ad")
- [ ] Memory importance decay — old low-weight memories fade over time
- [ ] Memory export/import (JSON file)
- [ ] Per-provider conversation history (multi-turn context)
- [ ] Plugin system for custom command handlers
