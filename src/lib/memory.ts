/**
 * Dual-tier memory system:
 *
 * TEMP  — sessionStorage, wiped on app restart. Tracks raw activity this session
 *         (searches, commands, sites visited). Used for behavioral learning.
 *
 * UNIVERSAL — localStorage (base64 JSON). Permanent facts + auto-learned
 *             behavioral patterns. Concept-entanglement graph for fuzzy recall.
 *
 * Auto-learning: after every activity, the behavior tracker checks whether any
 * topic has appeared ≥3 times without being stored — if so it's auto-stored
 * to universal memory with source "auto".
 */

// ── Shared types ─────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  ts: number;
  text: string;
  tags: string[];
  weight: number;
  src: "user" | "cmd" | "auto";
  tier: "universal";
}

export interface TempEntry {
  id: string;
  ts: number;
  type: "search" | "open" | "command" | "research" | "ai";
  content: string;
}

export interface BehaviorPattern {
  topic: string;
  count: number;
  firstTs: number;
  lastTs: number;
  autoStored: boolean;
}

export type MemoryRelationType = "person" | "tool" | "task" | "project" | "deadline";

export interface MemoryRelation {
  type: MemoryRelationType;
  value: string;
}

export interface RecallExplanation {
  memoryId: string;
  text: string;
  score: number;
  matchedTags: string[];
  relations: MemoryRelation[];
}

type ConceptMap = Record<string, Record<string, number>>;

interface UniversalStore {
  v: 2;
  mem: Memory[];
  map: ConceptMap;
  patterns: BehaviorPattern[];
}

interface TempStore {
  entries: TempEntry[];
  commandCount: number;
}

// ── Storage keys ─────────────────────────────────────────────────────────────

const UNIV_KEY = "cnova:mem";
const TEMP_KEY = "cnova:temp";

// ── Stop words ───────────────────────────────────────────────────────────────

const STOP = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","can","i","you","he","she","it","we","they","my","your","his",
  "her","its","our","their","what","which","who","when","where","why",
  "how","and","or","but","if","then","than","so","yet","for","of","to",
  "in","on","at","by","from","with","about","up","out","as","that","this",
  "these","those","not","no","nor","just","also","too","very","more","most",
  "get","got","let","put","say","said","like","know","think","want","need",
  "make","made","tell","told","go","going","come","came","me","some","any",
]);

const TAG_ALIASES: Record<string, string[]> = {
  telegram: ["tg", "chat", "message", "messaging"],
  gmail: ["email", "mail", "inbox"],
  youtube: ["yt", "video", "music"],
  chrome: ["browser", "web"],
  firefox: ["browser", "web"],
  spotify: ["music", "audio"],
  openai: ["ai", "gpt", "llm"],
  codex: ["ai", "assistant"],
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function loadUniversal(): UniversalStore {
  try {
    const raw = localStorage.getItem(UNIV_KEY);
    if (raw) {
      const parsed = JSON.parse(atob(raw));
      // Migrate v1 → v2 (add patterns array)
      if (parsed.v === 1) return { v: 2, mem: parsed.mem ?? [], map: parsed.map ?? {}, patterns: [] };
      return parsed as UniversalStore;
    }
  } catch { /* fall through */ }
  return { v: 2, mem: [], map: {}, patterns: [] };
}

function saveUniversal(store: UniversalStore): void {
  try { localStorage.setItem(UNIV_KEY, btoa(JSON.stringify(store))); } catch { /* full */ }
}

function loadTemp(): TempStore {
  try {
    const raw = sessionStorage.getItem(TEMP_KEY);
    if (raw) return JSON.parse(raw) as TempStore;
  } catch { /* fall through */ }
  return { entries: [], commandCount: 0 };
}

function saveTemp(store: TempStore): void {
  try { sessionStorage.setItem(TEMP_KEY, JSON.stringify(store)); } catch { /* full */ }
}

function normalizeToken(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && w.length > 4) w = w.slice(0, -1);
  return w;
}

function getTagAliases(tag: string): string[] {
  return TAG_ALIASES[tag] ?? [];
}

export function extractRelations(text: string): MemoryRelation[] {
  const out: MemoryRelation[] = [];
  const lower = text.toLowerCase();
  const push = (type: MemoryRelationType, value: string) => {
    if (!value.trim()) return;
    out.push({ type, value: value.trim() });
  };

  const person = text.match(/\b(?:to|for|with)\s+([a-z0-9._-]{2,30})/i);
  if (person) push("person", person[1]);

  const deadline = text.match(/\b(?:by|before|on)\s+([a-z]+\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/i);
  if (deadline) push("deadline", deadline[1]);

  if (/\btelegram|gmail|youtube|chrome|spotify|slack|discord\b/i.test(lower)) {
    const tool = (lower.match(/\b(telegram|gmail|youtube|chrome|spotify|slack|discord)\b/i) ?? [])[1];
    if (tool) push("tool", tool);
  }

  if (/\bworkflow|macro|automation|task\b/i.test(lower)) {
    const task = (text.match(/\b(?:workflow|macro|task)\s*:?(.+)$/i) ?? [])[1];
    if (task) push("task", task);
  }

  const project = text.match(/\bproject[:\s]+([a-z0-9 _-]{2,40})/i);
  if (project) push("project", project[1]);

  return out.slice(0, 8);
}

export function extractTags(text: string): string[] {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .map((w) => normalizeToken(w))
    .filter((w) => w.length > 2 && !STOP.has(w));

  const expanded: string[] = [];
  for (const tag of base) {
    expanded.push(tag);
    expanded.push(...getTagAliases(tag));
  }
  return [...new Set(expanded)].slice(0, 18);
}

function edgeWeightForTag(tag: string): number {
  if (tag.length >= 9) return 1.2;
  if (tag.length <= 3) return 0.6;
  return 1;
}

function updateConceptMap(map: ConceptMap, tags: string[], boost = 1): void {
  for (const a of tags) {
    if (!map[a]) map[a] = {};
    for (const b of tags) {
      if (a !== b) {
        const w = edgeWeightForTag(a) * edgeWeightForTag(b) * boost;
        map[a][b] = (map[a][b] ?? 0) + w;
      }
    }
  }
}

// ── Auto-learning ─────────────────────────────────────────────────────────────

/**
 * After app activity, check if any topic has appeared ≥3 times without
 * being auto-stored. If so, write it to universal memory automatically.
 */
function autoLearn(content: string, type: TempEntry["type"]): void {
  const store = loadUniversal();
  const tags = extractTags(content);
  const topic = tags.slice(0, 3).join(" ");
  if (!topic) return;
  const now = Date.now();
  const threshold = type === "research" || type === "search" ? 2 : 3;
  const memoryWeight = type === "research" || type === "search" ? 0.75 : 0.65;

  const existing = store.patterns.find((p) => p.topic === topic);
  if (existing) {
    existing.count += 1;
    existing.lastTs = now;
    if (existing.count >= threshold && !existing.autoStored) {
      existing.autoStored = true;
      const entry: Memory = {
        id: crypto.randomUUID(),
        ts: now,
        text: type === "search" || type === "research"
          ? `User frequently researches: ${content}`
          : `User frequently does: ${content}`,
        tags,
        weight: memoryWeight,
        src: "auto",
        tier: "universal",
      };
      store.mem.push(entry);
      updateConceptMap(store.map, tags, 1.25);
    }
  } else {
    store.patterns.push({ topic, count: 1, firstTs: now, lastTs: now, autoStored: false });
  }

  saveUniversal(store);
}

// ── TEMP MEMORY API ──────────────────────────────────────────────────────────

/** Log a session activity to temp memory. */
export function trackActivity(type: TempEntry["type"], content: string): void {
  const store = loadTemp();
  store.entries.unshift({
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    content,
  });
  store.entries = store.entries.slice(0, 100); // keep last 100
  store.commandCount += 1;
  saveTemp(store);
  autoLearn(content, type);
}

/** All temp entries this session, newest first. */
export function getTempMemory(): TempEntry[] {
  return loadTemp().entries;
}

/** Command count this session. */
export function sessionCommandCount(): number {
  return loadTemp().commandCount;
}

/** Recent searches this session. */
export function getRecentSearches(limit = 5): TempEntry[] {
  return loadTemp().entries.filter((e) => e.type === "search" || e.type === "research").slice(0, limit);
}

/** Recent sites opened this session. */
export function getRecentSites(limit = 5): TempEntry[] {
  return loadTemp().entries.filter((e) => e.type === "open").slice(0, limit);
}

// ── UNIVERSAL MEMORY API ──────────────────────────────────────────────────────

/** Store a permanent memory. */
export function remember(
  text: string,
  src: Memory["src"] = "user",
  weight = 0.5,
): Memory {
  const store = loadUniversal();
  const tags = extractTags(text);
  const entry: Memory = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    text,
    tags,
    weight,
    src,
    tier: "universal",
  };
  store.mem.push(entry);
  updateConceptMap(store.map, tags, src === "user" ? 1.35 : src === "cmd" ? 1.15 : 1);
  saveUniversal(store);
  return entry;
}

/**
 * Recall universal memories relevant to a query via concept-entanglement graph.
 */
export function recall(query: string, limit = 5): Memory[] {
  const store = loadUniversal();
  if (!store.mem.length) return [];

  const qTags = extractTags(query);
  if (!qTags.length) return store.mem.slice(-limit).reverse();

  const expanded = new Map<string, number>();
  const queryTokens = query.toLowerCase();
  for (const tag of qTags) {
    expanded.set(tag, 1.0);
    for (const alias of getTagAliases(tag)) {
      expanded.set(alias, Math.max(expanded.get(alias) ?? 0, 0.8));
    }
    const linked = store.map[tag] ?? {};
    for (const [rel, w] of Object.entries(linked)) {
      expanded.set(rel, Math.max(expanded.get(rel) ?? 0, Math.min(2.5, w * 0.25)));
    }
  }

  return store.mem
    .map((m) => {
      let tagScore = 0;
      let exactHits = 0;
      for (const tag of m.tags) {
        const s = expanded.get(tag) ?? 0;
        tagScore += s;
        if (qTags.includes(tag)) exactHits += 1;
      }
      const ageDays = Math.max(0, (Date.now() - m.ts) / (1000 * 60 * 60 * 24));
      const recencyBoost = Math.max(0.72, 1 - ageDays * 0.015);
      const exactTextBoost = m.text.toLowerCase().includes(queryTokens) ? 1.35 : 1;
      const score = (tagScore + exactHits * 0.7) * m.weight * recencyBoost * exactTextBoost;
      return { m, score };
    })
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

export function explainRecall(query: string, limit = 5): RecallExplanation[] {
  const store = loadUniversal();
  if (!store.mem.length) return [];

  const qTags = extractTags(query);
  const expanded = new Map<string, number>();
  const queryTokens = query.toLowerCase();

  for (const tag of qTags) {
    expanded.set(tag, 1.0);
    for (const alias of getTagAliases(tag)) expanded.set(alias, Math.max(expanded.get(alias) ?? 0, 0.8));
    const linked = store.map[tag] ?? {};
    for (const [rel, w] of Object.entries(linked)) expanded.set(rel, Math.max(expanded.get(rel) ?? 0, Math.min(2.5, w * 0.25)));
  }

  return store.mem
    .map((m) => {
      let tagScore = 0;
      let exactHits = 0;
      const matchedTags: string[] = [];
      for (const tag of m.tags) {
        const s = expanded.get(tag) ?? 0;
        if (s > 0) matchedTags.push(tag);
        tagScore += s;
        if (qTags.includes(tag)) exactHits += 1;
      }
      const ageDays = Math.max(0, (Date.now() - m.ts) / (1000 * 60 * 60 * 24));
      const recencyBoost = Math.max(0.72, 1 - ageDays * 0.015);
      const exactTextBoost = m.text.toLowerCase().includes(queryTokens) ? 1.35 : 1;
      const score = (tagScore + exactHits * 0.7) * m.weight * recencyBoost * exactTextBoost;
      return {
        memoryId: m.id,
        text: m.text,
        score,
        matchedTags: matchedTags.slice(0, 8),
        relations: extractRelations(m.text),
      };
    })
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Delete memories matching a query. Returns count removed. */
export function forget(query: string): number {
  const store = loadUniversal();
  const qTags = extractTags(query);
  const lower = query.toLowerCase();
  const before = store.mem.length;
  store.mem = store.mem.filter(
    (m) => !m.tags.some((t) => qTags.includes(t)) && !m.text.toLowerCase().includes(lower),
  );
  saveUniversal(store);
  return before - store.mem.length;
}

/** All universal memories, newest first. */
export function getAllMemories(): Memory[] {
  return loadUniversal().mem.slice().reverse();
}

/** Auto-learned behavioral patterns. */
export function getBehaviorPatterns(): BehaviorPattern[] {
  return loadUniversal().patterns.sort((a, b) => b.count - a.count);
}

export function getConceptMap(): ConceptMap {
  return loadUniversal().map;
}

export function memoryCount(): number {
  return loadUniversal().mem.length;
}

export function clearAllMemories(): void {
  saveUniversal({ v: 2, mem: [], map: {}, patterns: [] });
}
