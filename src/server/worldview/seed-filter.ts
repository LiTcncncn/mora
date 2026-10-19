import type { EnergyLevel } from "@/domain/common";
import type { MajorEventType, ResponseMode } from "@/domain/behavior-taxonomy";
import type { WorldviewScheduleState } from "@/domain/worldview-schedule";
import type { WorldviewSeed, WorldviewSettings } from "@/domain/worldview-v2";
import { fnv1aUnit } from "./hash-unit";

export interface SeedFilterContext {
  responseMode: ResponseMode;
  energy: EnergyLevel;
  majorEventType: MajorEventType | null;
  assistantTurnIndex: number;
  scheduleState: WorldviewScheduleState;
  settings: WorldviewSettings;
}

function isOnCooldown(
  seed: WorldviewSeed,
  context: SeedFilterContext,
): boolean {
  const recent = context.scheduleState.recentSeedIds.find(
    (entry) => entry.seedId === seed.id,
  );
  if (!recent) return false;
  return (
    context.assistantTurnIndex - recent.assistantTurnIndex <
    context.settings.seedCooldownTurns
  );
}

function isGroupOnCooldown(
  seed: WorldviewSeed,
  context: SeedFilterContext,
): boolean {
  const groupCooldown = context.settings.seedGroupCooldownTurns;
  if (groupCooldown > 0) {
    return context.scheduleState.recentSeedIds.some(
      (entry) =>
        entry.cooldownGroup === seed.cooldownGroup &&
        context.assistantTurnIndex - entry.assistantTurnIndex < groupCooldown,
    );
  }

  if (!context.settings.seedGroupNoConsecutive) return false;
  const lastOrganic = context.scheduleState.recentSeedIds.at(-1);
  if (!lastOrganic) return false;
  return lastOrganic.cooldownGroup === seed.cooldownGroup;
}

/** §9.9 第一段：模式无关过滤，用于合格轮判定。 */
export function filterSeedsStage1(
  seeds: WorldviewSeed[],
  context: SeedFilterContext,
): WorldviewSeed[] {
  return seeds.filter((seed) => {
    if (!seed.enabled) return false;
    if (!seed.allowedResponseModes.includes(context.responseMode)) return false;
    if (!seed.energyFit.includes(context.energy)) return false;
    if (
      context.majorEventType &&
      seed.blockedMajorEventTypes.includes(context.majorEventType)
    ) {
      return false;
    }
    if (isOnCooldown(seed, context)) return false;
    return true;
  });
}

/** §9.9 第二段：命中后过滤（含同组 K 轮冷却）。 */
export function filterSeedsStage2(
  seeds: WorldviewSeed[],
  context: SeedFilterContext,
  energyAllowedModes: Array<"W1" | "W2">,
): WorldviewSeed[] {
  return seeds.filter((seed) => {
    const intersection = seed.allowedModes.filter((mode) =>
      energyAllowedModes.includes(mode),
    );
    if (intersection.length === 0) return false;
    if (isGroupOnCooldown(seed, context)) return false;
    return true;
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。！？!?、；;：:""''（）()【】\[\]]+/)
    .filter((token) => token.length >= 1);
}

/** 中文标签/触发词：子串命中也算相关（「烦躁」↔「总是很烦躁」）。 */
function keywordRelevance(userMessage: string, keywords: string[]): number {
  const message = userMessage.toLowerCase();
  if (!message || keywords.length === 0) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    if (!normalized) continue;
    if (message.includes(normalized)) hits += 1;
  }
  return hits / keywords.length;
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const token of a) {
    if (setB.has(token)) hits += 1;
  }
  return hits / Math.max(a.length, b.length);
}

export function scoreSeedForMessage(
  seed: WorldviewSeed,
  userMessage: string,
  input: { responseMode: ResponseMode; energy: EnergyLevel },
): number {
  const userTokens = tokenize(userMessage);
  const tagKeywords = [...seed.tags, ...tokenize(seed.triggerDescription)];
  const tagHit = Math.max(
    keywordRelevance(userMessage, seed.tags),
    keywordRelevance(userMessage, [seed.triggerDescription]),
    overlapScore(userTokens, tagKeywords),
  );
  const triggerTokens = tokenize(seed.triggerDescription);
  const triggerOverlap = overlapScore(userTokens, triggerTokens);
  const textRelevance = Math.max(triggerOverlap, tagHit);
  const energyExact = seed.energyFit.includes(input.energy) ? 1 : 0;
  const modeExact = seed.allowedResponseModes.includes(input.responseMode)
    ? 1
    : 0;

  return (
    tagHit * 0.5 +
    textRelevance * 0.25 +
    energyExact * 0.1 +
    modeExact * 0.1 +
    0.05
  );
}

/** 软排序后得分阈值；过低时不注入，避免「烦躁」误选「下雨」。 */
export const MIN_SEED_RELEVANCE_SCORE = 0.22;

export function rankSeeds(
  seeds: WorldviewSeed[],
  input: {
    userMessage: string;
    responseMode: ResponseMode;
    energy: EnergyLevel;
  },
): WorldviewSeed[] {
  return [...seeds].sort((left, right) => {
    const leftScore = scoreSeedForMessage(left, input.userMessage, input);
    const rightScore = scoreSeedForMessage(right, input.userMessage, input);
    return rightScore - leftScore;
  });
}

/** 兼容旧调用：始终取最高分（等价 jitter=off 且 topK=1）。 */
export function pickBestSeed(
  seeds: WorldviewSeed[],
  input: {
    userMessage: string;
    responseMode: ResponseMode;
    energy: EnergyLevel;
  },
): { seed: WorldviewSeed | null; topScore: number } {
  return pickSeedForTurn(seeds, {
    ...input,
    settings: {
      seedSelectTopK: 1,
      seedSelectJitter: "off",
    },
    scheduleSeed: "deterministic",
    eligibleIndex: 0,
  });
}

/**
 * 在够分的前 K 名内按 jitter 策略选种；unit 由 scheduleSeed+eligibleIndex 派生，可复现。
 */
export function pickSeedForTurn(
  seeds: WorldviewSeed[],
  input: {
    userMessage: string;
    responseMode: ResponseMode;
    energy: EnergyLevel;
    settings: Pick<WorldviewSettings, "seedSelectTopK" | "seedSelectJitter">;
    scheduleSeed: string;
    eligibleIndex: number;
  },
): {
  seed: WorldviewSeed | null;
  topScore: number;
  candidateIds: string[];
} {
  if (seeds.length === 0) {
    return { seed: null, topScore: 0, candidateIds: [] };
  }

  const ranked = rankSeeds(seeds, input)
    .map((seed) => ({
      seed,
      score: scoreSeedForMessage(seed, input.userMessage, input),
    }))
    .filter((item) => item.score >= MIN_SEED_RELEVANCE_SCORE);

  if (ranked.length === 0) {
    const top = rankSeeds(seeds, input)[0]!;
    return {
      seed: null,
      topScore: scoreSeedForMessage(top, input.userMessage, input),
      candidateIds: [],
    };
  }

  const topScore = ranked[0]!.score;
  const topK = Math.max(1, Math.min(input.settings.seedSelectTopK, ranked.length));
  const pool = ranked.slice(0, topK);
  const candidateIds = pool.map((item) => item.seed.id);

  if (input.settings.seedSelectJitter === "off" || pool.length === 1) {
    return { seed: pool[0]!.seed, topScore, candidateIds };
  }

  const unit = fnv1aUnit(
    `${input.scheduleSeed}:seed-pick:${input.eligibleIndex}:${candidateIds.join(",")}`,
  );

  if (input.settings.seedSelectJitter === "uniform") {
    const index = Math.min(pool.length - 1, Math.floor(unit * pool.length));
    return { seed: pool[index]!.seed, topScore, candidateIds };
  }

  // weighted：分数为权重
  const weights = pool.map((item) => Math.max(item.score, 0.01));
  const sum = weights.reduce((acc, value) => acc + value, 0);
  let cursor = unit * sum;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index]!;
    if (cursor <= 0) {
      return { seed: pool[index]!.seed, topScore, candidateIds };
    }
  }
  return { seed: pool[pool.length - 1]!.seed, topScore, candidateIds };
}

/** 近 K 轮用过的组内标签，供 Prompt mustAvoid 去意象复读。 */
export function recentMotifHints(
  seeds: WorldviewSeed[],
  scheduleState: WorldviewScheduleState,
  assistantTurnIndex: number,
  lookbackTurns: number,
  excludeSeedId?: string | null,
): string[] {
  if (lookbackTurns <= 0) return [];
  const byId = new Map(seeds.map((seed) => [seed.id, seed]));
  const hints: string[] = [];
  for (const entry of scheduleState.recentSeedIds) {
    if (excludeSeedId && entry.seedId === excludeSeedId) continue;
    if (assistantTurnIndex - entry.assistantTurnIndex >= lookbackTurns) continue;
    const seed = byId.get(entry.seedId);
    if (!seed) continue;
    for (const tag of seed.tags.slice(0, 2)) {
      if (tag && !hints.includes(tag)) hints.push(tag);
    }
    if (hints.length >= 8) break;
  }
  return hints;
}
