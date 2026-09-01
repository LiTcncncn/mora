import { describe, expect, it } from "vitest";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import { computeConfigHash } from "@/server/config/behavior-hash";
import { retrieveBehaviorExample } from "@/server/example/retrieve";

describe("retrieveBehaviorExample", () => {
  it("匹配 COMPANION 疲惫示例", () => {
    const config = {
      ...buildDefaultBehaviorConfig("测试"),
      configHash: computeConfigHash(buildDefaultBehaviorConfig("测试")),
    };
    const result = retrieveBehaviorExample({
      cards: config.exampleCards,
      settings: config.exampleRetrieval,
      userMessage: "好累，什么都不想干",
      responseMode: "COMPANION",
      energy: "E1",
      questionPreference: "neutral",
      majorEventMatched: false,
    });
    expect(result.exampleId).toBe("card-companion-tired-001");
  });
});
