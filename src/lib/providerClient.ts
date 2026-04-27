import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderConfig } from "../store/novaStore";
import { getRecentChatContext } from "../store/novaStore";
import { recall } from "./memory";

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
