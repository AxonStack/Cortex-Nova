import { invoke } from "@tauri-apps/api/core";
import { remember, recall, forget } from "./memory";

export type CommandResult =
  | { type: "os_action"; message: string }
  | { type: "ai_query"; query: string }
  | { type: "research"; topic: string; steps: ResearchStep[] }
  | { type: "live_score"; query: string; url: string }
  | { type: "youtube_play"; query: string }
  | { type: "command_chain"; steps: CommandResult[] };

export interface ResearchStep {
  id: string;
  label: string;
  detail: string;
  url: string;
  delayMs: number;
}

function normalizeTranscript(transcript: string): string {
  return transcript
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/^(?:hey|okay|ok|yo|yeah|just)\s+/i, "")
    .replace(/^(?:please|pls)\s+/i, "")
    .replace(/^(?:cortex\s+nova|nova|cortex)\s+/i, "")
    .replace(/\s+/g, " ");
}

function splitChainedCommands(transcript: string): string[] {
  return transcript
    .split(/\s+(?:and then|then|after that|next)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

// ── System helpers ────────────────────────────────────────────────────────────

export async function openUrl(url: string): Promise<void> {
  try {
    await invoke("open_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function typeText(text: string): Promise<void> {
  await invoke<void>("type_text", { text });
}

async function mouseClick(x: number, y: number): Promise<void> {
  await invoke<void>("mouse_click", { x, y });
}

async function openApplication(app: string): Promise<void> {
  await invoke<void>("open_application", { app });
}

// ── Site shorthand map ────────────────────────────────────────────────────────

const SITE_MAP: Record<string, string> = {
  chrome:    "https://www.google.com",
  youtube:   "https://www.youtube.com",
  gmail:     "https://mail.google.com",
  github:    "https://www.github.com",
  twitter:   "https://www.twitter.com",
  reddit:    "https://www.reddit.com",
  firefox:   "https://www.mozilla.org",
  spotify:   "https://open.spotify.com",
  netflix:   "https://www.netflix.com",
  google:    "https://www.google.com",
  linkedin:  "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
  discord:   "https://discord.com/app",
  notion:    "https://www.notion.so",
  chatgpt:   "https://chat.openai.com",
};

const APP_ALIASES: Record<string, string> = {
  calculator: "calculator",
  calc: "calculator",
  terminal: "terminal",
  files: "files",
  "file manager": "files",
  spotify: "spotify",
  discord: "discord",
  slack: "slack",
  vscode: "code",
  "vs code": "code",
  code: "code",
  chrome: "google chrome",
  "google chrome": "google chrome",
  chromium: "chromium",
};

async function openTarget(target: string): Promise<CommandResult> {
  const trimmed = target.trim();
  const lower = trimmed.toLowerCase();
  const appName = APP_ALIASES[lower] ?? trimmed;

  try {
    await openApplication(appName);
    return { type: "os_action", message: `Opening app: ${trimmed}` };
  } catch {
    const siteUrl = SITE_MAP[lower];
    if (siteUrl) {
      await openUrl(siteUrl);
      return { type: "os_action", message: `Opening ${trimmed}` };
    }

    if (/^https?:\/\//i.test(trimmed)) {
      await openUrl(trimmed);
      return { type: "os_action", message: `Opening ${trimmed}` };
    }

    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) {
      const url = `https://${trimmed}`;
      await openUrl(url);
      return { type: "os_action", message: `Opening ${trimmed}` };
    }

    throw new Error(`Could not open "${trimmed}" as an app or website.`);
  }
}

// ── Research plan builder ─────────────────────────────────────────────────────

function buildResearchPlan(topic: string): ResearchStep[] {
  const q = encodeURIComponent(topic);
  const steps: ResearchStep[] = [
    {
      id: crypto.randomUUID(),
      label: "Search Google News",
      detail: `Searching Google News for "${topic}"`,
      url: `https://news.google.com/search?q=${q}&hl=en`,
      delayMs: 0,
    },
    {
      id: crypto.randomUUID(),
      label: "Find top Reddit discussion",
      detail: `Reddit — top posts this month about "${topic}"`,
      url: `https://www.reddit.com/search/?q=${q}&sort=top&t=month`,
      delayMs: 1800,
    },
    {
      id: crypto.randomUUID(),
      label: "Open Wikipedia overview",
      detail: `Wikipedia article for "${topic}"`,
      url: `https://en.wikipedia.org/w/index.php?search=${q}&ns0=1`,
      delayMs: 2800,
    },
    {
      id: crypto.randomUUID(),
      label: "Load highest-rated result",
      detail: `Google — top article about "${topic}"`,
      url: `https://www.google.com/search?q=${q}+most+viewed+article&tbs=sbd:1`,
      delayMs: 3800,
    },
  ];
  return steps;
}

function buildLiveScoreUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} live score`)}`;
}

// ── Command patterns ──────────────────────────────────────────────────────────

const OS_PATTERNS: Array<{
  pattern: RegExp;
  handler: (match: RegExpMatchArray) => Promise<CommandResult>;
}> = [
  // ── Chained browser intent: open Chrome → YouTube → play query ──────────
  {
    pattern: /^(?:first\s+)?open\s+(?:google\s+)?chrome(?:\s+then|\s+and)\s+(?:search\s+youtube|open\s+youtube|go\s+to\s+youtube)(?:\s+then|\s+and)\s+play\s+(.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },
  {
    pattern: /^(?:first\s+)?open\s+(?:google\s+)?chrome(?:\s+then|\s+and)\s+search\s+youtube\s+for\s+(.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },

  // ── Research / article finder ────────────────────────────────────────────
  {
    pattern: /^(?:get me|find|fetch|pull up|show me|search for)(?:\s+some)?\s+(?:articles?|news|info(?:rmation)?|coverage|reports?|results?)\s+(?:about|on|related to|regarding|covering)\s+(.+)/i,
    handler: async (match) => {
      const topic = match[1].trim();
      return { type: "research", topic, steps: buildResearchPlan(topic) };
    },
  },
  {
    pattern: /^research(?:\s+(?:about|on))?\s+(.+)/i,
    handler: async (match) => {
      const topic = match[1].trim();
      return { type: "research", topic, steps: buildResearchPlan(topic) };
    },
  },
  {
    pattern: /^(?:what(?:'s| is) (?:happening|going on) with|tell me about|brief me on)\s+(.+)/i,
    handler: async (match) => {
      const topic = match[1].trim();
      return { type: "research", topic, steps: buildResearchPlan(topic) };
    },
  },

  // ── Memory: remember ────────────────────────────────────────────────────
  {
    pattern: /^(?:remember|note|save|store)(?: that| this)? (.+)/i,
    handler: async (match) => {
      remember(match[1].trim(), "cmd", 0.8);
      return { type: "os_action", message: `Remembered: "${match[1].trim()}"` };
    },
  },

  // ── Memory: recall ──────────────────────────────────────────────────────
  {
    pattern: /^(?:recall|what do you (?:know|remember) about|do you remember) (.+)/i,
    handler: async (match) => {
      const hits = recall(match[1], 4);
      if (!hits.length)
        return { type: "os_action", message: `I don't have anything stored about "${match[1]}".` };
      const lines = hits.map((m) => m.text).join(". ");
      return { type: "os_action", message: `From memory: ${lines}` };
    },
  },

  // ── Memory: forget ──────────────────────────────────────────────────────
  {
    pattern: /^forget (?:about )?(.+)/i,
    handler: async (match) => {
      const n = forget(match[1]);
      return {
        type: "os_action",
        message: n > 0
          ? `Removed ${n} memor${n === 1 ? "y" : "ies"} about "${match[1]}".`
          : `Nothing found in memory about "${match[1]}".`,
      };
    },
  },

  // ── System: type text ───────────────────────────────────────────────────
  {
    pattern: /^type(?: out| in)? (.+)/i,
    handler: async (match) => {
      await typeText(match[1]);
      return { type: "os_action", message: `Typed: "${match[1]}"` };
    },
  },

  // ── System: mouse click ─────────────────────────────────────────────────
  {
    pattern: /^click (?:at )?(\d+)[, ]+(\d+)/i,
    handler: async (match) => {
      await mouseClick(parseInt(match[1]), parseInt(match[2]));
      return { type: "os_action", message: `Clicked at (${match[1]}, ${match[2]})` };
    },
  },

  // ── Sports: live/current score ──────────────────────────────────────────
  {
    pattern: /^(?:get me|show me|what(?:'s| is)|tell me)\s+(?:the\s+)?(?:current|live|latest)\s+(.+?)\s+score$/i,
    handler: async (match) => {
      const query = match[1].trim();
      return { type: "live_score", query, url: buildLiveScoreUrl(query) };
    },
  },
  {
    pattern: /^(?:current|live|latest)\s+(.+?)\s+score$/i,
    handler: async (match) => {
      const query = match[1].trim();
      return { type: "live_score", query, url: buildLiveScoreUrl(query) };
    },
  },

  // ── Media: play / open on youtube → full browser automation ────────────
  {
    pattern: /^play (.+?) on youtube/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },
  {
    pattern: /^open (.+?) (?:in|on) youtube/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },
  {
    pattern: /^(?:use\s+)?youtube(?:\s+to)?\s+play\s+(.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },
  {
    pattern: /^(?:use\s+)?youtube(?:\s+to)?\s+open\s+(.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },

  // ── Media: play on spotify ──────────────────────────────────────────────
  {
    pattern: /^play (.+?) on spotify/i,
    handler: async (match) => {
      await openUrl(`https://open.spotify.com/search/${encodeURIComponent(match[1])}`);
      return { type: "os_action", message: `Opening "${match[1]}" on Spotify` };
    },
  },

  // ── Media: play [song] ──────────────────────────────────────────────────
  {
    pattern: /^play (.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },

  // ── Search: youtube ─────────────────────────────────────────────────────
  {
    pattern: /^(?:search youtube for|youtube) (.+)/i,
    handler: async (match) => ({ type: "youtube_play", query: match[1].trim() }),
  },

  // ── Email: compose with body ─────────────────────────────────────────────
  {
    pattern: /^email (.+?) (?:about|re|regarding) (.+?) (?:saying|with body|that) (.+)/i,
    handler: async (match) => {
      const [, , subject, body] = match;
      await openUrl(
        `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
      return { type: "os_action", message: `Composing email: "${subject}"` };
    },
  },

  // ── Email: compose without body ─────────────────────────────────────────
  {
    pattern: /^email (.+?) (?:about|re|regarding) (.+)/i,
    handler: async (match) => {
      await openUrl(
        `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(match[2])}`,
      );
      return { type: "os_action", message: `Composing email about "${match[2]}"` };
    },
  },

  // ── Navigation: open X and go to Y ──────────────────────────────────────
  {
    pattern: /^open (.+?) and (?:go to|navigate to) (.+)/i,
    handler: async (match) => {
      const url = match[2].startsWith("http") ? match[2] : `https://${match[2]}`;
      await openUrl(url);
      return { type: "os_action", message: `Opening ${match[2]}` };
    },
  },

  // ── Search: general ─────────────────────────────────────────────────────
  {
    pattern: /^search (?:for )?(.+)/i,
    handler: async (match) => {
      await openUrl(`https://www.google.com/search?q=${encodeURIComponent(match[1])}`);
      return { type: "os_action", message: `Searching: "${match[1]}"` };
    },
  },

  // ── Navigation: go to URL ───────────────────────────────────────────────
  {
    pattern: /^(?:go to|navigate to|open) (https?:\/\/.+)/i,
    handler: async (match) => {
      await openUrl(match[1]);
      return { type: "os_action", message: `Opening ${match[1]}` };
    },
  },

  // ── Navigation: go to [site name] ───────────────────────────────────────
  {
    pattern: /^go to (.+)/i,
    handler: async (match) => openTarget(match[1]),
  },

  // ── Open [site name] ────────────────────────────────────────────────────
  {
    pattern: /^open (.+)/i,
    handler: async (match) => openTarget(match[1]),
  },
  {
    pattern: /^(?:launch|start|run) (.+)/i,
    handler: async (match) => openTarget(match[1]),
  },
];

// ── Router ───────────────────────────────────────────────────────────────────

async function routeSingleCommand(trimmed: string): Promise<CommandResult> {
  for (const { pattern, handler } of OS_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return handler(match);
  }
  return { type: "ai_query", query: trimmed };
}

export async function routeCommand(transcript: string): Promise<CommandResult> {
  const trimmed = normalizeTranscript(transcript);
  const parts = splitChainedCommands(trimmed);

  if (parts.length === 1) return routeSingleCommand(trimmed);

  const steps: CommandResult[] = [];
  for (const part of parts) {
    const step = await routeSingleCommand(part);
    steps.push(step);
  }

  if (steps.every((step) => step.type === "os_action")) {
    return {
      type: "os_action",
      message: steps.map((step) => step.message).join(". "),
    };
  }

  const priorSteps = steps.slice(0, -1);
  const lastStep = steps[steps.length - 1];

  if (priorSteps.every((step) => step.type === "os_action") && lastStep.type !== "ai_query") {
    return { type: "command_chain", steps };
  }

  return { type: "ai_query", query: trimmed };
}
