import { describe, expect, it } from "vitest";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import {
  MIN_SEED_RELEVANCE_SCORE,
  pickBestSeed,
  scoreSeedForMessage,
} from "./seed-filter";

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
