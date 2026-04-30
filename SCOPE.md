# Complete Developer Guide: Claude Code & OpenAI Codex CLI

> A practical walkthrough to get both tools running on your system, understand what they can do, and use them effectively for building real projects.

## Cortex Nova Direct Install (Users)

```bash
curl -fsSL https://raw.githubusercontent.com/AxonStack/Cortex-Nova/main/install.sh | bash
```

---

## Table of Contents

1. [What Are These Tools?](#1-what-are-these-tools)
2. [Claude Code — Full Walkthrough](#2-claude-code--full-walkthrough)
   - [Installation](#21-installation)
   - [Authentication](#22-authentication)
   - [Core Usage](#23-core-usage)
   - [CLAUDE.md — Your Project Brain](#24-claudemd--your-project-brain)
   - [Slash Commands Reference](#25-slash-commands-reference)
   - [IDE Integration](#26-ide-integration)
   - [MCP Servers](#27-mcp-servers)
   - [Sub-Agents & Multi-Agent Workflows](#28-sub-agents--multi-agent-workflows)
   - [Advanced: Plan Mode & Checkpoints](#29-advanced-plan-mode--checkpoints)
   - [Configuration File](#210-configuration-file)
3. [OpenAI Codex CLI — Full Walkthrough](#3-openai-codex-cli--full-walkthrough)
   - [Installation](#31-installation)
   - [Authentication](#32-authentication)
   - [Core Usage](#33-core-usage)
   - [AGENTS.md — Your Project Context](#34-agentsmd--your-project-context)
   - [Approval Modes](#35-approval-modes)
   - [Slash Commands Reference](#36-slash-commands-reference)
   - [IDE & Cloud Surfaces](#37-ide--cloud-surfaces)
   - [MCP Integration](#38-mcp-integration)
   - [Sub-Agents](#39-sub-agents)
   - [Configuration File](#310-configuration-file)
4. [Side-by-Side Comparison](#4-side-by-side-comparison)
5. [Best Practices for Both Tools](#5-best-practices-for-both-tools)
6. [Building the Nova Voice Assistant with Claude Code](#6-building-the-nova-voice-assistant-with-claude-code)

---

## 1. What Are These Tools?

Both tools are **agentic coding assistants** that live in your terminal. They go far beyond autocomplete — they can read your whole codebase, plan tasks, write and edit files, run commands, and iterate on their own output.

| | Claude Code | Codex CLI |
|---|---|---|
| **Made by** | Anthropic | OpenAI |
| **Model** | Claude Sonnet 4.6 / Opus 4.6 | GPT-5.4 / GPT-5.4-mini |
| **Built in** | Node.js | Rust |
| **Open Source** | Partially | Yes (fully) |
| **Context file** | `CLAUDE.md` | `AGENTS.md` |
| **Pricing** | Claude Pro/Max subscription or API key | ChatGPT Plus/Pro or API key |

---

## 2. Claude Code — Full Walkthrough

### 2.1 Installation

**Prerequisites:**
- Node.js 18 or higher (check: `node --version`)
- macOS, Linux, or Windows with WSL2

```bash
# Install globally via npm
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Check system health
claude doctor
```

> **Windows users:** Claude Code requires WSL2. Open PowerShell as admin and run `wsl --install`, then work entirely inside the WSL environment.

### 2.2 Authentication

There are two ways to authenticate:

**Option A — OAuth (Recommended for Pro/Max users)**
```bash
claude
# A browser window opens → sign in with your Anthropic account
# Done. No key management needed.
```

**Option B — API Key**
```bash
# Set the key securely using your OS keychain or secrets manager
export ANTHROPIC_API_KEY="sk-ant-..."

# Or add to your shell profile (less secure but simple for dev)
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
source ~/.bashrc

# Launch Claude Code
claude
```

### 2.3 Core Usage

```bash
# Start interactive session in current project
claude

# Pass a one-shot prompt (no interactive UI)
claude -p "Explain the architecture of this codebase"

# Non-interactive mode (for scripts and CI/CD)
claude --print "Add error handling to all API routes"

# Pipe content into Claude
cat error.log | claude -p "What's causing this error?"
tail -f app.log | claude -p "Alert me if you see anomalies"
```

Once inside the interactive UI:

```
You:  There's a bug where clicking the calendar doesn't set the right time
```

Claude will:
1. Read the relevant files
2. Explain its diagnosis
3. Show a diff of proposed changes
4. Ask for your approval before writing

### 2.4 CLAUDE.md — Your Project Brain

`CLAUDE.md` is the single most important file in your project. Claude Code reads it **automatically at the start of every session**, before reading anything else. Think of it as permanent instructions you only write once.

Create it at your project root:

```markdown
# Project: Nova Voice Assistant

## Tech Stack
- Framework: Tauri 2 (Rust backend + React frontend)
- Language: TypeScript (strict mode) + Rust
- Styling: Tailwind CSS
- State: Zustand

## Coding Rules
- Always create a git branch before making changes
- Use named exports, never default exports
- All components must be functional (no class components)
- Run `pnpm lint` before considering a task complete
- Keep components under 150 lines

## File Structure
- `src/` — React frontend
- `src-tauri/src/` — Rust backend
- `src/components/` — Shared UI components

## Do NOT
- Modify files in `src-tauri/target/` directly
- Install new dependencies without noting it in the response
- Use `any` types in TypeScript
```

> Commit `CLAUDE.md` to version control so your entire team benefits from it.

**Also create `.claudeignore`** to protect sensitive files and keep context lean:

```
.env
.env.*
node_modules/
target/
*.lock
dist/
build/
*.pem
*.key
```

### 2.5 Slash Commands Reference

These work inside the interactive Claude Code session:

| Command | What it does |
|---|---|
| `/help` | Show all available commands |
| `/model` | Switch between Sonnet 4.6 and Opus 4.6 |
| `/clear` | Wipe current session, start fresh |
| `/compact` | Compress context when it's getting large (use at ~70%) |
| `/resume <name>` | Resume a named previous session |
| `/rename` | Give current session a memorable name |
| `/rewind` | Restore to a previous checkpoint (press Esc twice) |
| `/stats` | View usage graphs and session history |
| `/review` | Ask Claude to review the current code |
| `/theme` | Preview and change the terminal color theme |
| `/copy` | Copy Claude's latest output to clipboard |
| `/status` | Check current model, context usage, session info |
| `/release-notes` | See what's new in this version |

### 2.6 IDE Integration

**VS Code / Cursor / Windsurf**

Install the official Claude Code extension from the marketplace. It adds:
- A sidebar panel showing Claude's actions in real time
- Inline diff view of proposed changes
- Seamless file context (Claude sees your open files)

**Recommended `settings.json` additions:**
```json
{
  "editor.formatOnSave": true,
  "terminal.integrated.defaultProfile.linux": "bash",
  "claude-code.autoApprove": false,
  "claude-code.showDiffs": true
}
```

### 2.7 MCP Servers

MCP (Model Context Protocol) lets Claude Code connect to external services like Gmail, GitHub, databases, and more.

**Configure in `~/.claude/settings.json`:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your_github_token"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    }
  }
}
```

Then in your session: `"Push my changes to GitHub and open a PR"`

**Install plugins from marketplace:**
```bash
/plugins install typescript-lsp
/plugins list
/plugins update
```

### 2.8 Sub-Agents & Multi-Agent Workflows

Sub-agents are specialized Claude instances with their own context windows. Use them to avoid bloating your main session.

```
You → Main Claude (coordinator)
       ├── Code Reviewer agent
       ├── Test Engineer agent
       └── Docs Writer agent
```

```bash
# Spin up an ad-hoc sub-agent
"Create a sub-agent to fetch and summarize the latest Tauri 2 docs,
 then give me just what's relevant to the audio plugin API"

# Background a sub-agent
# While it's working → press Ctrl+B to continue your main session
```

Sub-agents can run asynchronously in the background. This is powerful for large refactoring tasks where you want Claude to work on one module while you continue chatting about another.

### 2.9 Advanced: Plan Mode & Checkpoints

**Plan Mode** — Claude plans before it acts. Use it for any complex multi-file task.

```
You: [Plan Mode] Refactor the authentication system to use JWT instead of sessions
```

In Plan Mode, Claude can only think and explain — it cannot write files yet. Read the plan carefully, push back if needed, then approve. This is the lowest-cost point to course-correct.

**Checkpoints** — Auto-created for every prompt. Retained for 30 days.

```bash
# Restore to before the last change
# Press Esc twice OR:
/rewind

# Three restore modes:
# 1. Chat only    → rewind conversation, keep code changes
# 2. Code only    → revert file changes, keep conversation
# 3. Both         → full rollback to previous state
```

### 2.10 Configuration File

`~/.claude/settings.json` — global settings for all projects:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "API_TIMEOUT_MS": "300000"
  },
  "defaultModel": "claude-sonnet-4-6",
  "autoApprove": false,
  "theme": "dark"
}
```

---

## 3. OpenAI Codex CLI — Full Walkthrough

### 3.1 Installation

**Prerequisites:**
- Node.js 18+ (for npm install) or Homebrew (macOS)
- macOS or Linux. Windows: use WSL2 for best experience.

```bash
# Option A — npm (cross-platform)
npm install -g @openai/codex

# Option B — Homebrew (macOS)
brew install --cask codex

# Option C — Binary (all platforms)
# Download from: https://github.com/openai/codex/releases
# Pick your platform binary, rename to `codex`, put in PATH

# Verify
codex --version

# Update when new versions drop
npm update -g @openai/codex
```

**Windows WSL2 setup:**
```bash
# 1. Install WSL2 from PowerShell (admin)
wsl --install

# 2. Open Ubuntu terminal, then:
npm install -g @openai/codex

# Access Windows files at /mnt/c/
# But work within ~/projects/ for best performance
```

### 3.2 Authentication

**Option A — ChatGPT Account (included in Plus/Pro/Business/Edu/Enterprise)**
```bash
codex
# Browser opens → sign in with ChatGPT account
# Included in your plan at no extra API cost
```

**Option B — API Key (for headless/CI use)**
```bash
export OPENAI_API_KEY="sk-..."

# For CI/CD pipelines, set this as a repo secret
# and inject at runtime — never hardcode it
```

### 3.3 Core Usage

```bash
# Start interactive TUI session
codex

# With an initial prompt
codex "Explain how the auth middleware works"

# Non-interactive / scripted use
codex exec "Add input validation to all POST endpoints"

# Pipe output as JSON (for automation)
codex exec --json "List all TODO comments in the codebase"

# Resume most recent session
codex resume --last

# Fork a session into a new thread
codex fork --last
```

Inside the interactive TUI:

- Type `@` to open a fuzzy file search — drop files into context
- Press `Enter` while Codex is working to inject mid-turn instructions
- Press `Tab` to queue a follow-up prompt for the next turn
- Use `!command` to run shell commands inline

### 3.4 AGENTS.md — Your Project Context

The equivalent of Claude Code's `CLAUDE.md`. Codex merges them from multiple locations (repo root, subdirectories, home directory).

```markdown
# Nova Voice Assistant — Agent Instructions

## Project Overview
A cross-platform Tauri desktop app with voice activation ("Hey Nova"),
OS automation, and Claude AI integration.

## Stack
- Tauri 2 (Rust + React/TypeScript)
- Tailwind CSS
- Web Speech API for voice input

## Conventions
- Create a git branch before making any changes
- All new Rust functions must have doc comments
- TypeScript strict mode — no `any`
- Run `cargo clippy` before committing Rust code

## Repository Layout
- `src/` — React frontend
- `src-tauri/` — Rust Tauri backend
- `docs/` — Architecture notes

## Never
- Commit `.env` files
- Modify generated files in `src-tauri/target/`
```

### 3.5 Approval Modes

This controls how much Codex can do before asking you:

| Mode | What it means | When to use |
|---|---|---|
| `suggest` (default) | Shows proposed changes, waits for approval | Normal development |
| `on-request` | Runs commands freely, asks only when it needs help | Trusted tasks |
| `never` (--yolo) | Full autonomy, no approval prompts | CI/CD, automation scripts |

```bash
# Set approval mode per run
codex --approval-mode on-request "Refactor the config module"

# Or in config.toml
[defaults]
approval_mode = "on-request"

# Full yolo mode (be careful!)
codex --yolo "Set up the entire test suite"
```

### 3.6 Slash Commands Reference

| Command | What it does |
|---|---|
| `/model` | Switch model mid-session |
| `/review` | Ask Codex to review current changes |
| `/clear` | Start a fresh chat (Ctrl+L clears screen only) |
| `/copy` | Copy latest Codex output (Ctrl+O) |
| `/theme` | Preview and save a terminal color theme |
| `/search` | Enable live web search for current query |
| `!<cmd>` | Run a shell command inline (e.g., `!git log`) |
| `@<file>` | Insert a file path into context via fuzzy search |

### 3.7 IDE & Cloud Surfaces

**VS Code / Cursor / Windsurf extension:**
```
Search: "Codex" in VS Code marketplace → Install
```
- Appears in sidebar; sign in with ChatGPT account
- Starts in Agent mode by default
- Sees your open files automatically
- Model selector below the input box

**Codex Cloud (chatgpt.com/codex):**
- Assign async tasks from the web
- Connect your GitHub repo
- Tag `@codex` in a GitHub PR comment to trigger reviews
- Tasks run in a sandboxed environment; review results when done
- Works from mobile — start a task from your phone, review on desktop

**Desktop App:**
```bash
# Launch the desktop GUI version
codex app
```

### 3.8 MCP Integration

Codex uses the same MCP standard. Configure in `~/.codex/config.toml`:

```toml
[[mcp_servers]]
name = "github"
type = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.env]
GITHUB_TOKEN = "your_token"

[[mcp_servers]]
name = "postgres"
type = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
```

You can also run Codex itself as an MCP server so other agents can call it:

```bash
codex mcp
# Starts Codex as an MCP server over stdio
```

### 3.9 Sub-Agents

```bash
# Codex only spawns sub-agents when explicitly asked
"Spin up a sub-agent to run the test suite while I continue working on the feature"

# Sub-agents use same config.toml with role assignments
# Integrates with the OpenAI Agents SDK for:
# - Parallel task execution across modules
# - Orchestration (Codex as MCP server to other tools)
# - Full audit trails of what each agent did
```

### 3.10 Configuration File

`~/.codex/config.toml`:

```toml
[defaults]
model = "gpt-5.4"
approval_mode = "on-request"
web_search = "cached"   # "live" or "disabled"

[env]
OPENAI_API_KEY = "sk-..."

# Override per invocation:
# codex -c approval_mode=never
# codex -c model=gpt-5.4-mini
```

---

## 4. Side-by-Side Comparison

| Feature | Claude Code | Codex CLI |
|---|---|---|
| **Trigger word** | `claude` | `codex` |
| **Context file** | `CLAUDE.md` | `AGENTS.md` |
| **Best for** | Deep reasoning, long autonomous sessions | Speed, scripting, Rust-native performance |
| **Model switching** | `/model` | `/model` or `--model` flag |
| **Session resume** | `/resume <name>` | `codex resume --last` |

---

## Cortex Nova Product Scope Additions (Approved)

### 1. Reliability Layer
- Add bounded retries with backoff for desktop actions.
- Add post-action verification checks (focus/window/url heuristics).
- Add cancellation and recovery handling for multi-step chains.

### 2. Safer Automation
- Introduce risk tiers for desktop actions.
- Require explicit confirmation for high-risk actions (send/submit/secrets).
- Add app allowlist/denylist controls under Permissions.

### 3. Better Self-Learning
- Track success/failure outcomes for learned patterns.
- Learn from user corrections and prefer corrected paths.
- Add lifecycle rules (promote reliable macros, decay stale ones).

### 4. Memory + Knowledge Graph
- Add typed relations (`person`, `tool`, `task`, `project`, `deadline`).
- Weight concept edges by usage outcomes and recency.
- Add graph explainability in UI (why a recall matched).

### 5. Planner Quality
- Add deterministic templates for common workflows (Telegram, Gmail, meetings).
- Add missing-detail detection with one concise clarification question.
- Add simulation mode (“plan only, do not execute”).

### 6. UI Surface Expansion
- Add Workflows page (save/run/edit/delete and reliability metadata).
- Add execution timeline with step-level latency and verification state.
- Add provider health page (latency/failure/token usage where available).

### 7. Model Controls
- Add per-task model routing (chat/planner/vision).
- Add fallback provider chains.
- Add quick model profiles (`Fast`, `Balanced`, `Accurate`).

### 8. DevOps + QA
- Structured local audit logs for action chains.
- End-to-end smoke tests for top intents.
- One-command dev doctor/recovery script for Vite/Tauri runtime issues.

### 9. Product Extensions
- Scheduled automations.
- Workspace modes and context bundles.
- Voice quality presets and local/remote tradeoff controls.
| **Checkpoints** | `/rewind` (auto-created) | Git recommended |
| **Plan before act** | Plan Mode (`[Plan Mode]` prefix) | Approval Mode = `suggest` |
| **MCP servers** | `~/.claude/settings.json` | `~/.codex/config.toml` |
| **Sub-agents** | Dynamic or named | Role-based via config |
| **IDE extension** | VS Code, Cursor, Windsurf | VS Code, Cursor, Windsurf |
| **Cloud version** | N/A | chatgpt.com/codex |
| **Non-interactive** | `claude --print "..."` | `codex exec "..."` |
| **Pipe support** | `cat file \| claude -p "..."` | `cat file \| codex exec "..."` |
| **Web search** | Via MCP | Built-in (cached by default) |
| **Context limit tip** | `/compact` at 70% usage | `/clear` for fresh session |

---

## 5. Best Practices for Both Tools

### Start Every Project Right

```bash
# Claude Code
touch CLAUDE.md .claudeignore
echo "target/\nnode_modules/\n.env" > .claudeignore

# Codex
touch AGENTS.md
```

### Always Plan Before Big Tasks

```
# Claude Code
[Plan Mode] Rebuild the database layer to use Prisma instead of raw SQL

# Codex
Propose a plan (don't make changes yet) for migrating from REST to GraphQL
```

Read the plan. Push back. Approve only when you're satisfied. This is the cheapest point to course-correct.

### Context Window Management

```
Claude Code:
0–50%   → Work freely
50–70%  → Keep an eye on things
70–90%  → Run /compact
90%+    → Run /clear, start fresh

Codex:
Long sessions → Use codex fork to branch off without losing history
```

### Git-First Workflow

Both tools can modify your codebase. Always:

```bash
git checkout -b feature/ai-assisted-refactor
# Let Claude Code or Codex work
git diff          # Review everything before committing
git add -p        # Stage selectively, not blindly
git commit -m "feat: ..."
```

Instruct this in your `CLAUDE.md` or `AGENTS.md`:
```
Always create a git branch before making any file changes.
```

### Use Non-Interactive Mode for Automation

```bash
# Claude Code in CI
claude --print "Run all tests and report failures" > test-report.txt

# Codex in CI
codex exec --json "Check for security vulnerabilities in dependencies" \
  | jq '.findings'
```

### Model Choice

```
Claude Code:
  Sonnet 4.6 → Single features, debugging, docs, daily work
  Opus 4.6   → Extended autonomous sessions, architectural decisions

Codex CLI:
  gpt-5.4       → Most tasks; strong coding + reasoning
  gpt-5.4-mini  → Lightweight tasks, subagents, fast iteration
```

---

## 6. Building the Nova Voice Assistant with Claude Code

Here's exactly how to use Claude Code to build your Hey Nova project from the ground up.

### Step 1 — Bootstrap the Project

```bash
# Create the Tauri project
npm create tauri-app@latest nova -- --template react-ts
cd nova

# Create the CLAUDE.md
cat > CLAUDE.md << 'EOF'
# Nova — AI Voice Assistant

## Stack
- Tauri 2 (Rust + React + TypeScript)
- Tailwind CSS, Zustand, Framer Motion
- Web Speech API (voice input)
- Anthropic Claude API (AI brain)

## Rules
- Always branch before changes: `git checkout -b feature/<name>`
- TypeScript strict mode, no `any`
- Rust functions must have doc comments
- Run `pnpm lint && cargo clippy` before finishing

## Architecture
- Wake word detection: Web Speech API continuous listening
- Command parsing: Claude claude-sonnet-4-6 via Anthropic API  
- OS actions: Tauri shell plugin (open URLs, apps, run commands)
- UI: Floating overlay window, glassmorphism style

## Never
- Commit .env files
- Modify src-tauri/target/
EOF

# Open Claude Code
claude
```

### Step 2 — Let Claude Code Build It

```
You: Set up the full project structure for Nova. 
     Install Tailwind, Framer Motion, and Zustand. 
     Configure Tauri shell and notification plugins.
     Create a floating overlay window that appears on wake word detection.
```

```
You: Now build the voice listener in React. 
     Use the Web Speech API to continuously listen.
     When the phrase "Hey Nova" is detected, activate the assistant UI.
     Show a pulsing waveform animation when active.
```

```
You: Wire up the command handler. 
     When I say "open Chrome and go to YouTube", 
     use the Tauri shell plugin to run the browser command.
     When I say "search for X", open the default browser with a Google search.
     When I say "email <name> about <subject>", open Gmail compose.
```

```
You: Connect the Claude API. 
     For any command that isn't a direct OS action,  
     send it to Claude claude-sonnet-4-6 and speak the response 
     using the Web Speech Synthesis API.
```

### Step 3 — Iterate

```
You: The wake word detection is too sensitive. 
     Add a confidence threshold and only trigger on 
     "Hey Nova" with confidence > 0.85

You: [Plan Mode] Refactor the command routing into a 
     plugin architecture so I can add new commands 
     without touching the core listener logic
```

---

## Official Documentation Links

| Resource | URL |
|---|---|
| Claude Code Docs | https://docs.claude.com/en/docs/claude-code/overview |
| Claude Code Changelog | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| Claude API Docs | https://docs.claude.com |
| Codex CLI Docs | https://developers.openai.com/codex/cli |
| Codex Quickstart | https://developers.openai.com/codex/quickstart |
| Codex CLI GitHub | https://github.com/openai/codex |
| Codex Models | https://developers.openai.com/codex/models |
| Codex Features | https://developers.openai.com/codex/cli/features |
| Codex CLI Reference | https://developers.openai.com/codex/cli/reference |

---

*Last updated: April 2026. Both tools release updates frequently — check changelogs regularly.*
