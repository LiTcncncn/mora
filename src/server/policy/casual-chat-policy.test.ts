import { describe, expect, it } from "vitest";
import {
  applyCasualChatOverrides,
  isIdleCasualChat,
  isTopicHandoff,
} from "@/server/policy/casual-chat-policy";
import type { TurnPlan } from "@/domain/turn-plan";

function basePlan(overrides: Partial<TurnPlan> = {}): TurnPlan {
  return {
    energy: "E2",
    responseMode: "COMPANION",
    questionPreference: "neutral",
    majorEvent: { matched: false, firstMention: false, type: null },
    responseBudget: {
      targetMinChars: 80,
      targetMaxChars: 220,
      hardMaxChars: 300,
      maxSentences: 5,
      maxQuestions: 1,
      maxActions: 0,
      providerMaxOutputTokens: 460,
    },
    mustDo: ["回应最具体、最重的部分"],
    mustAvoid: ["原因分析"],
    worldview: {
      mode: "pending",
      source: "none",
      seedId: null,
      canonFactIds: [],
    },
    selectedExampleId: null,
    ...overrides,
  };
}

describe("casual-chat-policy", () => {
  it("识别话题权交接", () => {
    expect(isTopicHandoff("你说点什么吧")).toBe(true);
    expect(isTopicHandoff("聊点怪的")).toBe(true);
    expect(isTopicHandoff("讲个好玩的")).toBe(true);
    expect(isTopicHandoff("我现在很闲")).toBe(false);
  });

  it("识别无情绪载荷闲聊", () => {
    expect(isIdleCasualChat("我也不知道聊什么，我现在很闲")).toBe(true);
    expect(isIdleCasualChat("你说点什么")).toBe(false);
  });

  it("话题权交接时强制贡献内容且不许提问", () => {
    const plan = applyCasualChatOverrides(basePlan(), "你说点什么，聊点怪的");
    expect(plan.mustDo[0]).toContain("主动贡献");
    expect(plan.mustAvoid.some((line) => line.includes("丢回"))).toBe(true);
    expect(plan.responseBudget.maxQuestions).toBe(0);
  });

  it("闲聊时压缩篇幅并禁止许可式陪伴", () => {
    const plan = applyCasualChatOverrides(
      basePlan(),
      "我也不知道聊什么，我现在很闲",
    );
    expect(plan.mustDo[0]).toContain("室友");
    expect(plan.mustAvoid.some((line) => line.includes("许可式"))).toBe(true);
    expect(plan.responseBudget.targetMaxChars).toBeLessThanOrEqual(90);
    expect(plan.responseBudget.maxSentences).toBeLessThanOrEqual(2);
    expect(plan.responseBudget.maxQuestions).toBe(0);
  });
});
