type BrainActionKind = "open_app" | "browse" | "type" | "click" | "research" | "media";

interface BinaryBrainState {
  trainedSamples: number;
  tokenWeights: Record<string, number>;
  actionScores: Record<BrainActionKind, number>;
  recentIntents: string[];
}

const STORAGE_KEY = "nova-binary-brain-v1";
const RECENT_LIMIT = 10;

const DEFAULT_STATE: BinaryBrainState = {
  trainedSamples: 0,
  tokenWeights: {},
  actionScores: {
    open_app: 0,
    browse: 0,
    type: 0,
    click: 0,
    research: 0,
    media: 0,
  },
  recentIntents: [],
};

function encodeState(state: BinaryBrainState): string {
  return btoa(JSON.stringify(state));
}

function decodeState(encoded: string): BinaryBrainState | null {
  try {
    const decoded = atob(encoded.trim());
    const parsed = JSON.parse(decoded) as BinaryBrainState;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      actionScores: { ...DEFAULT_STATE.actionScores, ...(parsed.actionScores ?? {}) },
      tokenWeights: parsed.tokenWeights ?? {},
      recentIntents: Array.isArray(parsed.recentIntents) ? parsed.recentIntents.slice(0, RECENT_LIMIT) : [],
    };
  } catch {
    return null;
  }
}

function readState(): BinaryBrainState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as BinaryBrainState;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      actionScores: { ...DEFAULT_STATE.actionScores, ...(parsed.actionScores ?? {}) },
      tokenWeights: parsed.tokenWeights ?? {},
      recentIntents: Array.isArray(parsed.recentIntents) ? parsed.recentIntents.slice(0, RECENT_LIMIT) : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: BinaryBrainState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function inferKinds(text: string): BrainActionKind[] {
  const t = text.toLowerCase();
  const kinds: BrainActionKind[] = [];
  if (/\b(open|launch|run|start)\b/.test(t)) kinds.push("open_app");
  if (/\b(go to|navigate|search|website|browser|chrome|url)\b/.test(t)) kinds.push("browse");
  if (/\b(type|write|enter)\b/.test(t)) kinds.push("type");
  if (/\b(click|tap|cursor|mouse)\b/.test(t)) kinds.push("click");
  if (/\b(research|articles|news|brief)\b/.test(t)) kinds.push("research");
  if (/\b(play|youtube|song|music|video)\b/.test(t)) kinds.push("media");
  return kinds.length ? kinds : ["browse"];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 2)
    .slice(0, 24);
}

export function trainBinaryBrain(query: string, executedLabels: string[]) {
  const state = readState();
  const kinds = inferKinds(`${query} ${executedLabels.join(" ")}`);
  const tokens = tokenize(query);

  for (const token of tokens) {
    state.tokenWeights[token] = (state.tokenWeights[token] ?? 0) + 1;
  }
  for (const kind of kinds) {
    state.actionScores[kind] = (state.actionScores[kind] ?? 0) + 1;
  }

  state.trainedSamples += 1;
  state.recentIntents = [query, ...state.recentIntents].slice(0, RECENT_LIMIT);
  writeState(state);
}

export function getBinaryBrainContext(): string {
  const state = readState();
  const sortedKinds = Object.entries(state.actionScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const topTokens = Object.entries(state.tokenWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);

  return [
    `[Binary brain] samples=${state.trainedSamples}`,
    sortedKinds.length ? `top_action_patterns=${sortedKinds.join(",")}` : "",
    topTokens.length ? `top_tokens=${topTokens.join(",")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getBinaryBrainStats() {
  const state = readState();
  return {
    trainedSamples: state.trainedSamples,
    topIntents: state.recentIntents,
  };
}

export function exportBinaryBrain(): string {
  return encodeState(readState());
}

export function importBinaryBrain(encoded: string): boolean {
  const decoded = decodeState(encoded);
  if (!decoded) return false;
  writeState(decoded);
  return true;
}

export function resetBinaryBrain() {
  writeState(DEFAULT_STATE);
}
