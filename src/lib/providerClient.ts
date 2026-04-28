import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderConfig } from "../store/novaStore";
import { getRecentChatContext } from "../store/novaStore";
import { recall, trackActivity } from "./memory";
import type { CommandResult } from "./commandRouter";
import { buildResearchPlan } from "./commandRouter";

const SYSTEM_PROMPT =
  "You are Cortex Nova, a helpful voice assistant. Keep responses concise and conversational — they will be spoken aloud. Aim for 1–3 sentences. Never claim you opened apps, triggered permissions, or completed OS actions unless the app has already confirmed that happened. If an action sounds like device control but you do not have confirmation, say you cannot verify it instead of inventing a permission prompt.";

function getChatHistory(query: string) {
  const history = getRecentChatContext();
  if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].text === query) {
    return history.slice(0, -1);
  }
  return history;
}

async function askAnthropic(query: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const history = getChatHistory(query);
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: history.map((msg) => ({
      role: msg.role === "ai" ? ("assistant" as const) : ("user" as const),
      content: msg.text,
    })).concat({ role: "user", content: query }),
  });
  const block = message.content[0];
  return block.type === "text" ? block.text : "I couldn't process that.";
}

async function askOpenAI(query: string, apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  const history = getChatHistory(query);
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((msg) => ({
        role: msg.role === "ai" ? "assistant" as const : "user" as const,
        content: msg.text,
      })),
      { role: "user", content: query },
    ],
  });
  return response.choices[0]?.message?.content ?? "I couldn't process that.";
}

async function askOllama(query: string, model: string, baseUrl: string): Promise<string> {
  const history = getChatHistory(query);
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((msg) => ({
          role: msg.role === "ai" ? "assistant" : "user",
          content: msg.text,
        })),
        { role: "user", content: query },
      ],
    }),
  });

  if (res.status === 404) {
    throw new Error(`Model "${model}" not found in Ollama. Run: ollama pull ${model}`);
  }
  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}. Is Ollama running at ${baseUrl}?`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "I couldn't process that.";
}

/** Delegate to the Claude Code CLI (`claude --print`). No API key needed. */
async function askClaudeCLI(query: string): Promise<string> {
  const history = getChatHistory(query);
  const transcript = history.map((msg) => `${msg.role === "ai" ? "Assistant" : "User"}: ${msg.text}`).join("\n");
  const fullPrompt = transcript
    ? `${SYSTEM_PROMPT}\n\n[Recent conversation]\n${transcript}\n\n[User]\n${query}`
    : `${SYSTEM_PROMPT}\n\n${query}`;
  return invoke<string>("ask_via_cli", { cli: "claude", prompt: fullPrompt });
}

/** Delegate to the OpenAI Codex CLI. No API key needed. */
async function askCodexCLI(query: string): Promise<string> {
  const history = getChatHistory(query);
  const transcript = history.map((msg) => `${msg.role === "ai" ? "Assistant" : "User"}: ${msg.text}`).join("\n");
  const fullPrompt = transcript
    ? `${SYSTEM_PROMPT}\n\n[Recent conversation]\n${transcript}\n\n[User]\n${query}`
    : `${SYSTEM_PROMPT}\n\n${query}`;
  return invoke<string>("ask_via_cli", { cli: "codex", prompt: fullPrompt });
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}

/** Check if a CLI tool is installed and on the PATH (via Tauri). */
export async function checkCLI(cli: "claude" | "codex"): Promise<boolean> {
  try {
    return await invoke<boolean>("check_cli_available", { cli });
  } catch {
    return false;
  }
}

// ── OS Tool definitions for Claude tool use ───────────────────────────────────

const OS_TOOLS: Anthropic.Tool[] = [
  {
    name: "open_app",
    description: "Open a desktop application by name. Use for any request to open, launch, or start an installed app.",
    input_schema: {
      type: "object" as const,
      properties: {
        app: { type: "string", description: "App name, e.g. 'spotify', 'telegram', 'calculator', 'vscode', 'terminal', 'chrome', 'firefox'" },
        label: { type: "string", description: "Short spoken confirmation, e.g. 'Opening Spotify'" },
      },
      required: ["app", "label"],
    },
  },
  {
    name: "open_url",
    description: "Open a URL or website in the browser. Use when the user mentions a website, web app, or a URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "Full URL including https://" },
        label: { type: "string", description: "Short spoken confirmation, e.g. 'Opening GitHub'" },
      },
      required: ["url", "label"],
    },
  },
  {
    name: "search_web",
    description: "Search the web on Google. Use when the user wants to look something up or search for information.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "play_youtube",
    description: "Search and play a video, song, or music on YouTube.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Song, artist, or video to play" },
      },
      required: ["query"],
    },
  },
  {
    name: "type_text",
    description: "Type text into the currently focused window or application.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type" },
      },
      required: ["text"],
    },
  },
  {
    name: "research_topic",
    description: "Research a topic by opening multiple browser sources (News, Reddit, Wikipedia). Use when the user wants articles, news, or information about a topic.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Topic to research" },
      },
      required: ["topic"],
    },
  },
  {
    name: "respond",
    description: "Give a spoken text response without performing any OS action. Use for questions, facts, jokes, general conversation, or anything that doesn't require desktop control.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Concise 1-3 sentence spoken response" },
      },
      required: ["message"],
    },
  },
];

const TOOL_USE_SYSTEM =
  "You are Cortex Nova, a Jarvis-style AI desktop assistant with full control over the user's computer. " +
  "You MUST always call one of the provided tools — never respond with plain text. " +
  "For any request to open an app, website, or file → call open_app or open_url. " +
  "For music, videos → call play_youtube. " +
  "For web searches → call search_web. " +
  "For articles, news, research → call research_topic. " +
  "For typing something → call type_text. " +
  "For questions, facts, or conversation → call respond with a short spoken answer. " +
  "You have the ability to open ANY app the user asks for. Never refuse OS tasks.";

/**
 * Route a user query through Claude tool use so any natural-language OS request
 * (e.g. "can you open Spotify?", "launch telegram for me") is understood and
 * executed rather than refused as a plain chat reply.
 */
export async function routeViaAI(query: string, config: ProviderConfig): Promise<CommandResult> {
  // For non-Anthropic providers, extract intent from plain text and best-effort parse it.
  if (config.provider !== "anthropic" || !config.apiKey) {
    const text = await askAI(query, config);
    return { type: "os_action", message: text };
  }

  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: TOOL_USE_SYSTEM,
    messages: [{ role: "user", content: query }],
    tools: OS_TOOLS,
    tool_choice: { type: "any" },
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    return { type: "os_action", message: "I'm not sure how to help with that." };
  }

  const inp = toolUse.input as Record<string, string>;
  trackActivity("ai", `tool:${toolUse.name}:${query}`);

  switch (toolUse.name) {
    case "open_app":
      return { type: "desktop_open_app", app: inp.app, label: inp.label ?? `Opening ${inp.app}` };

    case "open_url":
      return { type: "browser_navigate", url: inp.url, label: inp.label ?? `Opening ${inp.url}` };

    case "search_web":
      return {
        type: "browser_navigate",
        url: `https://www.google.com/search?q=${encodeURIComponent(inp.query)}`,
        label: `Searching: "${inp.query}"`,
      };

    case "play_youtube":
      return { type: "youtube_play", query: inp.query };

    case "type_text":
      return { type: "desktop_type_text", text: inp.text, label: `Typed: "${inp.text}"` };

    case "research_topic":
      return { type: "research", topic: inp.topic, steps: buildResearchPlan(inp.topic) };

    case "respond":
      return { type: "os_action", message: inp.message };

    default:
      return { type: "os_action", message: "I'm not sure how to help with that." };
  }
}

export async function askAI(query: string, config: ProviderConfig): Promise<string> {
  const hits = recall(query, 3);
  const ctx = hits.length
    ? `[Memory context]\n${hits.map((m) => `- ${m.text}`).join("\n")}\n\n[Query]\n`
    : "";
  const q = ctx + query;

  switch (config.provider) {
    case "anthropic":  return askAnthropic(q, config.apiKey);
    case "openai":     return askOpenAI(q, config.apiKey);
    case "ollama":     return askOllama(q, config.ollamaModel, config.ollamaUrl);
    case "claude_cli": return askClaudeCLI(q);
    case "codex_cli":  return askCodexCLI(q);
  }
}
