import type { EnergyLevel } from "@/domain/common";
import type { MajorEventType, ResponseMode } from "@/domain/behavior-taxonomy";
import type { WorldviewScheduleState } from "@/domain/worldview-schedule";
import type { WorldviewSeed, WorldviewSettings } from "@/domain/worldview-v2";

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

/** §9.9 第二段：命中后过滤。 */
export function filterSeedsStage2(
  seeds: WorldviewSeed[],
  context: SeedFilterContext,
  energyAllowedModes: Array<"W1" | "W2">,
): WorldviewSeed[] {
  const lastOrganic = context.scheduleState.recentSeedIds.at(-1);

  return seeds.filter((seed) => {
    const intersection = seed.allowedModes.filter((mode) =>
      energyAllowedModes.includes(mode),
    );
    if (intersection.length === 0) return false;

    if (context.settings.seedGroupNoConsecutive && lastOrganic) {
      const lastGroup = context.scheduleState.recentSeedIds.find(
        (entry) => entry.seedId === lastOrganic.seedId,
      )?.cooldownGroup;
      if (lastGroup && lastGroup === seed.cooldownGroup) return false;
    }
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

/** 软排序后得分最高的种子；得分过低时返回 null，避免「烦躁」误选「下雨」。 */
export const MIN_SEED_RELEVANCE_SCORE = 0.22;

export function pickBestSeed(
  seeds: WorldviewSeed[],
  input: {
    userMessage: string;
    responseMode: ResponseMode;
    energy: EnergyLevel;
  },
): { seed: WorldviewSeed | null; topScore: number } {
  if (seeds.length === 0) return { seed: null, topScore: 0 };
  const ranked = [...seeds].sort(
    (left, right) =>
      scoreSeedForMessage(right, input.userMessage, input) -
      scoreSeedForMessage(left, input.userMessage, input),
  );
  const top = ranked[0]!;
  const topScore = scoreSeedForMessage(top, input.userMessage, input);
  if (topScore < MIN_SEED_RELEVANCE_SCORE) {
    return { seed: null, topScore };
  }
  return { seed: top, topScore };
}

/** §9.9：第二段过滤后的软排序。 */
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
