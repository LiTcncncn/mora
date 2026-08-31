import type { MemoryItem, MemorySelectionTrace } from "@/domain/memory";
import type { MemorySettings } from "@/domain/settings";

const STOP_WORDS = new Set([
  "的",
  "了",
  "是",
  "我",
  "你",
  "他",
  "她",
  "在",
  "和",
  "就",
  "都",
  "也",
  "很",
  "a",
  "an",
  "the",
  "is",
  "are",
  "to",
  "of",
  "and",
  "i",
  "you",
]);

const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

/** 中文用字符 bigram，英文用小写单词。不引入 embedding。 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  for (const word of lower.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) {
      if (!STOP_WORDS.has(word)) tokens.add(word);
      continue;
    }
    const chars = [...word].filter((char) => !STOP_WORDS.has(char));
    for (let index = 0; index < chars.length; index += 1) {
      const single = chars[index]!;
      tokens.add(single);
      const next = chars[index + 1];
      if (next) tokens.add(`${single}${next}`);
    }
  }
  return tokens;
}

function keywordRelevance(query: Set<string>, content: string): number {
  if (query.size === 0) return 0;
  const contentTokens = tokenize(content);
  if (contentTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of query) {
    if (contentTokens.has(token)) overlap += 1;
  }
  return overlap / query.size;
}

function recencyScore(memory: MemoryItem, now: number): number {
  const reference = Date.parse(memory.lastUsedAt ?? memory.updatedAt);
  if (Number.isNaN(reference)) return 0;
  const age = now - reference;
  if (age <= 0) return 1;
  return Math.max(0, 1 - age / RECENCY_WINDOW_MS);
}

export interface MemorySelectionResult {
  selected: MemoryItem[];
  trace: MemorySelectionTrace[];
}

export function selectMemories(input: {
  memories: MemoryItem[];
  userMessage: string;
  settings: MemorySettings;
  now?: Date;
}): MemorySelectionResult {
  const { memories, userMessage, settings } = input;
  const now = (input.now ?? new Date()).getTime();

  if (!settings.enabled) {
    return {
      selected: [],
      trace: memories.map((memory) => ({
        memoryId: memory.id,
        selected: false,
        scores: {
          pinned: 0,
          importance: 0,
          recency: 0,
          keywordRelevance: 0,
          total: 0,
        },
        reason: "Memory 注入已在设置中关闭",
      })),
    };
  }

  const query = tokenize(userMessage);
  const weightSum =
    settings.weights.pinned +
    settings.weights.importance +
    settings.weights.recency +
    settings.weights.keywordRelevance;

  const scored = memories.map((memory) => {
    const pinned = memory.pinned ? 1 : 0;
    const importance = memory.importance;
    const recency = recencyScore(memory, now);
    const keyword = keywordRelevance(query, memory.content);
    const rawTotal =
      pinned * settings.weights.pinned +
      importance * settings.weights.importance +
      recency * settings.weights.recency +
      keyword * settings.weights.keywordRelevance;
    const total = weightSum > 0 ? rawTotal / weightSum : 0;

    const expired =
      memory.expiresAt !== null && Date.parse(memory.expiresAt) <= now;
    const typeIncluded = settings.includedTypes.includes(memory.type);
    const belowImportance =
      !memory.pinned && memory.importance < settings.minImportance;

    let ineligibleReason: string | null = null;
    if (!memory.enabled) ineligibleReason = "该 Memory 已停用";
    else if (memory.status !== "active")
      ineligibleReason = `状态为 ${memory.status}，只有 active 会进入上下文`;
    else if (expired) ineligibleReason = "已过期";
    else if (!typeIncluded) ineligibleReason = `类型 ${memory.type} 未包含在设置中`;
    else if (belowImportance)
      ineligibleReason = `重要度 ${memory.importance} 低于阈值 ${settings.minImportance}`;

    return {
      memory,
      scores: { pinned, importance, recency, keywordRelevance: keyword, total },
      ineligibleReason,
    };
  });

  const eligible = scored
    .filter((entry) => entry.ineligibleReason === null)
    .sort((a, b) => {
      if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total;
      if (b.scores.pinned !== a.scores.pinned)
        return b.scores.pinned - a.scores.pinned;
      if (b.memory.importance !== a.memory.importance)
        return b.memory.importance - a.memory.importance;
      if (a.memory.updatedAt !== b.memory.updatedAt)
        return b.memory.updatedAt.localeCompare(a.memory.updatedAt);
      return a.memory.id.localeCompare(b.memory.id);
    });

  const selected: MemoryItem[] = [];
  const selectionReason = new Map<string, string>();
  let usedChars = 0;

  for (const entry of eligible) {
    if (selected.length >= settings.topK) {
      selectionReason.set(entry.memory.id, `超出 topK=${settings.topK}`);
      continue;
    }
    const length = [...entry.memory.content].length;
    if (usedChars + length > settings.maxChars) {
      selectionReason.set(
        entry.memory.id,
        `超出字符预算 maxChars=${settings.maxChars}`,
      );
      continue;
    }
    usedChars += length;
    selected.push(entry.memory);
    selectionReason.set(
      entry.memory.id,
      `入选，综合得分 ${entry.scores.total.toFixed(3)}`,
    );
  }

  const selectedIds = new Set(selected.map((memory) => memory.id));
  const trace: MemorySelectionTrace[] = scored.map((entry) => ({
    memoryId: entry.memory.id,
    selected: selectedIds.has(entry.memory.id),
    scores: entry.scores,
    reason:
      entry.ineligibleReason ??
      selectionReason.get(entry.memory.id) ??
      "未入选",
  }));

  trace.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total;
    return a.memoryId.localeCompare(b.memoryId);
  });

  return { selected, trace };
}
