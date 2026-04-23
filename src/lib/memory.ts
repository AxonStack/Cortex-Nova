/**
 * Binary Memory Language Map
 *
 * Memories are stored as base64-encoded JSON in localStorage — a compact
 * "binary" envelope. Each memory carries concept tags extracted from the text.
 * A concept map (language map) records how tags co-occur, so recalling by
 * topic surfaces not just exact matches but semantically entangled memories.
 *
 * Architecture:
 *   MemoryStore (serialised → base64 → localStorage)
 *   ├── mem[]           — individual memory entries
 *   └── map{}           — concept graph  tag → { related_tag: weight }
 *
 * When storing:  extract tags → add entry → update concept graph weights
 * When recalling: extract query tags → expand via concept graph → rank by score
 */

export interface Memory {
  id: string;
  ts: number;             // unix ms
  text: string;           // raw content
  tags: string[];         // extracted concept tokens
  weight: number;         // importance 0–1 (user-set or default 0.5)
  src: "user" | "cmd";    // who wrote this
}

/** concept tag → map of { related_tag: co-occurrence weight } */
type ConceptMap = Record<string, Record<string, number>>;

interface MemoryStore {
  v: 1;
  mem: Memory[];
  map: ConceptMap;
}

const STORE_KEY = "cnova:mem";

// Common English words that carry no semantic meaning
const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","can","i","you","he","she","it","we","they","my","your","his",
  "her","its","our","their","what","which","who","when","where","why",
  "how","and","or","but","if","then","than","so","yet","for","of","to",
  "in","on","at","by","from","with","about","up","out","as","that","this",
  "these","those","not","no","nor","just","also","too","very","more","most",
  "get","got","let","put","say","said","like","know","think","want","need",
  "make","made","tell","told","go","going","come","came",
]);

// ── Internal helpers ─────────────────────────────────────────────────────────

function load(): MemoryStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(atob(raw)) as MemoryStore;
  } catch { /* fall through to default */ }
  return { v: 1, mem: [], map: {} };
}

function save(store: MemoryStore): void {
  try {
    localStorage.setItem(STORE_KEY, btoa(JSON.stringify(store)));
  } catch { /* storage full — ignore */ }
}

function extractTags(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(tokens)].slice(0, 12);
}

function updateConceptMap(map: ConceptMap, tags: string[]): void {
  for (const a of tags) {
    if (!map[a]) map[a] = {};
    for (const b of tags) {
      if (a !== b) map[a][b] = (map[a][b] ?? 0) + 1;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Store a new memory. Returns the created entry. */
export function remember(
  text: string,
  src: Memory["src"] = "user",
  weight = 0.5,
): Memory {
  const store = load();
  const tags = extractTags(text);
  const entry: Memory = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    text,
    tags,
    weight,
    src,
  };
  store.mem.push(entry);
  updateConceptMap(store.map, tags);
  save(store);
  return entry;
}

/**
 * Recall memories relevant to a query.
 * Uses the concept map to expand tag search beyond exact matches.
 */
export function recall(query: string, limit = 5): Memory[] {
  const store = load();
  if (!store.mem.length) return [];

  const qTags = extractTags(query);
  if (!qTags.length) return store.mem.slice(-limit).reverse();

  // Expand query tags through the concept map
  const expanded = new Map<string, number>();
  for (const tag of qTags) {
    expanded.set(tag, 1.0);
    const linked = store.map[tag] ?? {};
    for (const [rel, w] of Object.entries(linked)) {
      // Related concepts contribute at 40% of their co-occurrence weight
      expanded.set(rel, Math.max(expanded.get(rel) ?? 0, w * 0.4));
    }
  }

  const scored = store.mem.map((m) => {
    let score = 0;
    for (const tag of m.tags) score += expanded.get(tag) ?? 0;
    score *= m.weight; // importance scales the score
    return { m, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

/** Remove memories whose tags or text match the query. Returns count deleted. */
export function forget(query: string): number {
  const store = load();
  const qTags = extractTags(query);
  const lower = query.toLowerCase();
  const before = store.mem.length;
  store.mem = store.mem.filter(
    (m) =>
      !m.tags.some((t) => qTags.includes(t)) &&
      !m.text.toLowerCase().includes(lower),
  );
  save(store);
  return before - store.mem.length;
}

/** All stored memories, newest first. */
export function getAllMemories(): Memory[] {
  return load().mem.slice().reverse();
}

/** The full concept co-occurrence graph. */
export function getConceptMap(): ConceptMap {
  return load().map;
}

/** How many memories are stored. */
export function memoryCount(): number {
  return load().mem.length;
}

/** Erase everything. */
export function clearAllMemories(): void {
  save({ v: 1, mem: [], map: {} });
}
