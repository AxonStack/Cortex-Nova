import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderConfig } from "../store/novaStore";
import { getRecentChatContext, useNovaStore } from "../store/novaStore";
import { recall, trackActivity } from "./memory";
import type { CommandResult } from "./commandRouter";
import { buildResearchPlan } from "./commandRouter";
import { getBinaryBrainContext } from "./binaryBrain";

const SYSTEM_PROMPT =
  "You are Cortex Nova, a helpful voice assistant. Keep responses concise and conversational — they will be spoken aloud. Aim for 1–3 sentences. Never claim you opened apps, triggered permissions, or completed OS actions unless the app has already confirmed that happened. If an action sounds like device control but you do not have confirmation, say you cannot verify it instead of inventing a permission prompt.";

const ACTION_PLANNER_SYSTEM =
  "You are Cortex Nova's execution planner. Convert the user's request into a strict JSON action plan that the app can execute.\n\n" +
  "Return JSON only. No prose. No markdown. No code fences.\n\n" +
  "Schema:\n" +
  '{\"actions\":[{...}]}\n\n' +
  "Allowed action types:\n" +
  'respond, open_app, close_app, open_url, search_web, play_youtube, compose_email, type_text, focus_window, press_key, mouse_click, research_topic.\n\n' +
  "Action fields:\n" +
  'respond -> {\"type\":\"respond\",\"message\":\"short spoken reply\"}\n' +
  'open_app -> {\"type\":\"open_app\",\"app\":\"google chrome\",\"label\":\"Opening Chrome\"}\n' +
  'close_app -> {\"type\":\"close_app\",\"app\":\"spotify\",\"label\":\"Closing Spotify\"}\n' +
  'open_url -> {\"type\":\"open_url\",\"url\":\"https://example.com\",\"label\":\"Opening example.com\"}\n' +
  'search_web -> {\"type\":\"search_web\",\"query\":\"latest space news\",\"label\":\"Searching latest space news\"}\n' +
  'play_youtube -> {\"type\":\"play_youtube\",\"query\":\"lofi hip hop\"}\n' +
  'compose_email -> {\"type\":\"compose_email\",\"to\":\"name@example.com\",\"subject\":\"Hello\",\"body\":\"Draft text\"}\n' +
  'type_text -> {\"type\":\"type_text\",\"text\":\"hello world\",\"label\":\"Typing hello world\"}\n' +
  'focus_window -> {\"type\":\"focus_window\",\"name\":\"chrome\",\"label\":\"Focusing Chrome\"}\n' +
  'press_key -> {\"type\":\"press_key\",\"keys\":\"ctrl+l\",\"label\":\"Selecting address bar\"}\n' +
  'mouse_click -> {\"type\":\"mouse_click\",\"x\":960,\"y\":540,\"label\":\"Clicking the center of the screen\"}\n' +
  'research_topic -> {\"type\":\"research_topic\",\"topic\":\"Iran US war\"}\n\n' +
  "Rules:\n" +
  "1. Think like a human using the computer.\n" +
  "2. For browser tasks inside Chrome, prefer a sequence like open_app -> focus_window -> press_key ctrl+l -> type_text -> press_key return.\n" +
  "3. Use the fewest reliable steps.\n" +
  "4. If the user explicitly wants typing/clicking inside an app, use primitive steps rather than only open_url.\n" +
  "5. Do not invent missing email addresses, coordinates, or page state.\n" +
  "6. Use chat history and memory context to resolve references.\n" +
  "7. If a required detail is missing, return one respond action asking one concise clarification.\n" +
  "8. If the request is purely informational, return one respond action.\n" +
  "9. Do not say actions already happened. Plan only.";

type ChatHistoryEntry = { role: "user" | "ai"; text: string };
type PlannerAction =
  | { type: "respond"; message: string }
  | { type: "open_app"; app: string; label?: string }
  | { type: "close_app"; app: string; label?: string }
  | { type: "open_url"; url: string; label?: string }
  | { type: "search_web"; query: string; label?: string }
  | { type: "play_youtube"; query: string }
  | { type: "compose_email"; to?: string; subject?: string; body?: string }
  | { type: "type_text"; text: string; label?: string }
  | { type: "focus_window"; name: string; label?: string }
  | { type: "press_key"; keys: string; label?: string }
  | { type: "mouse_click"; x: number; y: number; label?: string }
  | { type: "research_topic"; topic: string };

function getChatHistory(query: string): ChatHistoryEntry[] {
  const history = getRecentChatContext();
  if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].text === query) {
    return history.slice(0, -1);
  }
  return history;
}

function decorateQueryWithMemory(query: string): string {
  const binaryEnabled = useNovaStore.getState().binaryBrain.enabled;
  const hits = recall(query, 3);
  const ctx = hits.length
    ? `[Memory context]\n${hits.map((m) => `- ${m.text}`).join("\n")}\n\n[Query]\n`
    : "";
  const binaryCtx = binaryEnabled ? `\n\n${getBinaryBrainContext()}\n\n` : "\n\n";
  return `${ctx}${binaryCtx}${query}`;
}

function buildCliPrompt(systemPrompt: string, query: string): string {
  const history = getChatHistory(query);
  const transcript = history.map((msg) => `${msg.role === "ai" ? "Assistant" : "User"}: ${msg.text}`).join("\n");
  if (transcript) {
    return `${systemPrompt}\n\n[Recent conversation]\n${transcript}\n\n[User]\n${query}`;
  }
  return `${systemPrompt}\n\n[User]\n${query}`;
}

async function askAnthropicVision(
  query: string,
  config: ProviderConfig,
  images: ImageAttachment[],
): Promise<string> {
  if (config.provider !== "anthropic" || !config.apiKey) {
    return "Image understanding requires the Anthropic provider. Please configure your API key in Setup.";
  }
  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = images.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mimeType,
      data: img.dataUrl.includes(",") ? img.dataUrl.split(",")[1] : img.dataUrl,
    },
  }));
  content.push({ type: "text", text: query });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "You are Cortex Nova, a helpful voice assistant with vision. Describe and analyze images accurately and concisely. Respond conversationally in 2-4 sentences.",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: "user", content }] as any,
  });
  const block = message.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "I couldn't analyze the image.";
}

async function askAnthropic(
  query: string,
  apiKey: string,
  systemPrompt = SYSTEM_PROMPT,
  images?: Array<{ mimeType: string; dataUrl: string }>,
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const history = getChatHistory(query);

  // Build user content: optional images followed by the text query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [];
  if (images && images.length > 0) {
    for (const img of images) {
      const data = img.dataUrl.includes(",") ? img.dataUrl.split(",")[1] : img.dataUrl;
      userContent.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data } });
    }
  }
  userContent.push({ type: "text", text: query });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const historyMessages: any[] = history.map((msg) => ({
    role: msg.role === "ai" ? "assistant" : "user",
    content: msg.text,
  }));
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [...historyMessages, { role: "user", content: userContent }] as any,
  });
  const block = message.content.find((entry) => entry.type === "text");
  return block?.type === "text" ? block.text : "I couldn't process that.";
}

async function askOpenAI(query: string, apiKey: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  const history = getChatHistory(query);
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === "ai" ? "assistant" as const : "user" as const,
        content: msg.text,
      })),
      { role: "user", content: query },
    ],
  });
  return response.choices[0]?.message?.content ?? "I couldn't process that.";
}

async function askOllama(
  query: string,
  model: string,
  baseUrl: string,
  systemPrompt = SYSTEM_PROMPT,
): Promise<string> {
  const history = getChatHistory(query);
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
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

async function askClaudeCLI(query: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  return invoke<string>("ask_via_cli", { cli: "claude", prompt: buildCliPrompt(systemPrompt, query) });
}

async function askCodexCLI(query: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  return invoke<string>("ask_via_cli", { cli: "codex", prompt: buildCliPrompt(systemPrompt, query) });
}

type ImageAttachment = { mimeType: string; dataUrl: string };

async function askProvider(
  query: string,
  config: ProviderConfig,
  systemPrompt = SYSTEM_PROMPT,
  images?: ImageAttachment[],
): Promise<string> {
  switch (config.provider) {
    case "anthropic":
      return askAnthropic(query, config.apiKey, systemPrompt, images);
    case "openai":
      return askOpenAI(query, config.apiKey, systemPrompt);
    case "ollama":
      return askOllama(query, config.ollamaModel, config.ollamaUrl, systemPrompt);
    case "claude_cli":
      return askClaudeCLI(query, systemPrompt);
    case "codex_cli":
      return askCodexCLI(query, systemPrompt);
  }
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

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? raw.trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return source.slice(first, last + 1);
}

function mapPlannerAction(action: PlannerAction): CommandResult {
  switch (action.type) {
    case "respond":
      return { type: "os_action", message: action.message };
    case "open_app":
      return { type: "desktop_open_app", app: action.app, label: action.label ?? `Opening ${action.app}` };
    case "close_app":
      return { type: "desktop_close_app", app: action.app, label: action.label ?? `Closing ${action.app}` };
    case "open_url":
      return { type: "browser_navigate", url: action.url, label: action.label ?? `Opening ${action.url}` };
    case "search_web":
      return {
        type: "browser_navigate",
        url: `https://www.google.com/search?q=${encodeURIComponent(action.query)}`,
        label: action.label ?? `Searching: "${action.query}"`,
      };
    case "play_youtube":
      return { type: "youtube_play", query: action.query };
    case "compose_email": {
      const params = new URLSearchParams();
      params.set("view", "cm");
      params.set("fs", "1");
      if (action.to) params.set("to", action.to);
      if (action.subject) params.set("su", action.subject);
      if (action.body) params.set("body", action.body);
      const url = `https://mail.google.com/mail/?${params.toString()}`;
      const recipient = action.to ? ` to ${action.to}` : "";
      return { type: "browser_navigate", url, label: `Composing email${recipient}` };
    }
    case "type_text":
      return { type: "desktop_type_text", text: action.text, label: action.label ?? `Typed: "${action.text}"` };
    case "focus_window":
      return { type: "desktop_focus_window", name: action.name, label: action.label ?? `Focusing ${action.name}` };
    case "press_key":
      return { type: "desktop_press_key", keys: action.keys, label: action.label ?? `Pressing ${action.keys}` };
    case "mouse_click":
      return {
        type: "desktop_mouse_click",
        x: Number(action.x),
        y: Number(action.y),
        label: action.label ?? `Clicked at (${action.x}, ${action.y})`,
      };
    case "research_topic":
      return { type: "research", topic: action.topic, steps: buildResearchPlan(action.topic) };
  }
}

function normalizePlannerAction(raw: unknown): PlannerAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Record<string, unknown>;
  const type = typeof action.type === "string" ? action.type.toLowerCase() : "";

  switch (type) {
    case "respond":
      return typeof action.message === "string" ? { type: "respond", message: action.message } : null;
    case "open_app":
      return typeof action.app === "string"
        ? { type: "open_app", app: action.app, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "close_app":
      return typeof action.app === "string"
        ? { type: "close_app", app: action.app, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "open_url":
      return typeof action.url === "string"
        ? { type: "open_url", url: action.url, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "search_web":
      return typeof action.query === "string"
        ? { type: "search_web", query: action.query, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "play_youtube":
      return typeof action.query === "string" ? { type: "play_youtube", query: action.query } : null;
    case "compose_email":
      return {
        type: "compose_email",
        to: typeof action.to === "string" ? action.to : undefined,
        subject: typeof action.subject === "string" ? action.subject : undefined,
        body: typeof action.body === "string" ? action.body : undefined,
      };
    case "type_text":
      return typeof action.text === "string"
        ? { type: "type_text", text: action.text, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "focus_window":
      return typeof action.name === "string"
        ? { type: "focus_window", name: action.name, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "press_key":
      return typeof action.keys === "string"
        ? { type: "press_key", keys: action.keys, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "mouse_click":
      return typeof action.x === "number" && typeof action.y === "number"
        ? { type: "mouse_click", x: action.x, y: action.y, label: typeof action.label === "string" ? action.label : undefined }
        : null;
    case "research_topic":
      return typeof action.topic === "string" ? { type: "research_topic", topic: action.topic } : null;
    default:
      return null;
  }
}

function parsePlannerResponse(raw: string): CommandResult | null {
  const json = extractJsonObject(raw);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as { actions?: unknown[] };
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.map(normalizePlannerAction).filter((entry): entry is PlannerAction => entry !== null)
      : [];

    if (actions.length === 0) return null;
    const mapped = actions.map(mapPlannerAction);
    return mapped.length === 1 ? mapped[0] : { type: "command_chain", steps: mapped };
  } catch {
    return null;
  }
}

export async function routeViaAI(
  query: string,
  config: ProviderConfig,
  images?: ImageAttachment[],
): Promise<CommandResult> {
  // Vision queries: raw query + images, no decoration, no chat history
  if (images && images.length > 0) {
    const isPlaceholder = !query || query === "(attachment)" || query === "(image attached)";
    const visionQuery = isPlaceholder ? "Please describe what you see in this image in detail." : query;
    const reply = await askAnthropicVision(visionQuery, config, images);
    return { type: "os_action", message: reply };
  }
  const plannedQuery = decorateQueryWithMemory(query);
  const rawPlan = await askProvider(plannedQuery, config, ACTION_PLANNER_SYSTEM);
  const planned = parsePlannerResponse(rawPlan);

  if (planned) {
    trackActivity("ai", `plan:${query}`);
    return planned;
  }

  const fallback = await askProvider(plannedQuery, config, SYSTEM_PROMPT);
  return { type: "os_action", message: fallback };
}

export async function askAI(query: string, config: ProviderConfig): Promise<string> {
  return askProvider(decorateQueryWithMemory(query), config, SYSTEM_PROMPT);
}
