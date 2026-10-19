import { describe, expect, it } from "vitest";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import { createInitialWorldviewScheduleState } from "@/domain/worldview-schedule";
import type { WorldviewSeed } from "@/domain/worldview-v2";
import {
  filterSeedsStage2,
  MIN_SEED_RELEVANCE_SCORE,
  pickBestSeed,
  pickSeedForTurn,
  scoreSeedForMessage,
} from "./seed-filter";

function baseSeed(overrides: Partial<WorldviewSeed> & Pick<WorldviewSeed, "id" | "title">): WorldviewSeed {
  return {
    tags: ["测试"],
    triggerDescription: "测试触发",
    memory: "测试画面",
    attitude: "测试态度",
    allowedResponseModes: ["COMPANION"],
    energyFit: ["E0", "E1", "E2", "E3"],
    allowedModes: ["W1"],
    blockedMajorEventTypes: [],
    avoidClaims: [],
    cooldownGroup: "test",
    canonFactIds: [],
    enabled: true,
    version: 1,
    ...overrides,
  };
}

describe("seed-filter relevance", () => {
  const config = buildDefaultBehaviorConfig("测试");
  const irritable = config.worldviewSeeds.find(
    (seed) => seed.id === "seed-irritable-007",
  )!;
  const rain = config.worldviewSeeds.find((seed) => seed.id === "seed-rain-001")!;

  it("烦躁消息更匹配烦躁种子而非下雨种子", () => {
    const message = "最近心情不好；总是很烦躁";
    const irritableScore = scoreSeedForMessage(irritable, message, {
      responseMode: "COMPANION",
      energy: "E1",
    });
    const rainScore = scoreSeedForMessage(rain, message, {
      responseMode: "COMPANION",
      energy: "E1",
    });
    expect(irritableScore).toBeGreaterThan(rainScore);

    const picked = pickBestSeed([rain, irritable], {
      userMessage: message,
      responseMode: "COMPANION",
      energy: "E1",
    });
    expect(picked.seed?.id).toBe("seed-irritable-007");
    expect(picked.topScore).toBeGreaterThanOrEqual(MIN_SEED_RELEVANCE_SCORE);
  });
});

describe("seed-filter cooldown and jitter", () => {
  const a = baseSeed({
    id: "seed-a",
    title: "A",
    cooldownGroup: "rain",
    tags: ["累", "迷茫"],
    triggerDescription: "用户很累很迷茫",
  });
  const b = baseSeed({
    id: "seed-b",
    title: "B",
    cooldownGroup: "rain",
    tags: ["累", "迷茫"],
    triggerDescription: "用户很累很迷茫",
  });
  const c = baseSeed({
    id: "seed-c",
    title: "C",
    cooldownGroup: "light",
    tags: ["累", "迷茫"],
    triggerDescription: "用户很累很迷茫",
  });

  it("同组在 seedGroupCooldownTurns 内会被第二段过滤掉", () => {
    const scheduleState = createInitialWorldviewScheduleState({
      scheduleSeed: "sched-test",
      schedulerAlgorithmVersion: "credit-v1",
    });
    scheduleState.recentSeedIds = [
      { seedId: "seed-a", cooldownGroup: "rain", assistantTurnIndex: 10 },
    ];

    const filtered = filterSeedsStage2([a, b, c], {
      responseMode: "COMPANION",
      energy: "E1",
      majorEventType: null,
      assistantTurnIndex: 12,
      scheduleState,
      settings: {
        ...buildDefaultBehaviorConfig("测试").worldview,
        seedGroupCooldownTurns: 6,
      },
    }, ["W1", "W2"]);

    expect(filtered.map((seed) => seed.id)).toEqual(["seed-c"]);
  });

  it("jitter=off 时始终取最高分", () => {
    const picked = pickSeedForTurn([a, c], {
      userMessage: "我很累很迷茫",
      responseMode: "COMPANION",
      energy: "E1",
      settings: { seedSelectTopK: 3, seedSelectJitter: "off" },
      scheduleSeed: "sched-test",
      eligibleIndex: 3,
    });
    expect(picked.seed).not.toBeNull();
    expect(picked.candidateIds.length).toBeGreaterThan(0);
    expect(picked.seed?.id).toBe(picked.candidateIds[0]);
  });
});
