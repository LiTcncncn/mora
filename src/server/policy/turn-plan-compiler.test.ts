import { describe, expect, it } from "vitest";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import { computeConfigHash } from "@/server/config/behavior-hash";
import { compileTurnPlan } from "@/server/policy/turn-plan-compiler";
import { classifyTurnRules } from "@/server/router/fallback";
import { evaluateSafety } from "@/server/safety/evaluate";
import { finalizeBehaviorTurn } from "@/server/worldview/finalize-behavior-turn";

function planFor(message: string) {
  const config = {
    ...buildDefaultBehaviorConfig("测试"),
    configHash: computeConfigHash(buildDefaultBehaviorConfig("测试")),
  };
  const safety = evaluateSafety(message, config.safety);
  const routing = classifyTurnRules(
    {
      currentUserMessage: message,
      recentCanonicalMessages: [],
      previousEnergy: null,
      lastAssistantAskedQuestion: false,
      safetyResolution: safety,
    },
    config.requestFlags,
  );
  const basePlan = compileTurnPlan({
    routing,
    config,
    safety,
    lastAssistantAskedQuestion: false,
  });
  return finalizeBehaviorTurn({
    basePlan,
    routing,
    safety,
    config,
    conversation: {
      id: "conv-test",
      profileId: "profile-test",
      title: "测试",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    },
    userMessage: message,
  }).turnPlan;
}

describe("compileTurnPlan", () => {
  it("低能量消息编译为较短预算", () => {
    const plan = planFor("好累啊");
    expect(plan.energy).toBe("E1");
    expect(["COMPANION", "ASK_LIGHT"]).toContain(plan.responseMode);
    expect(plan.responseBudget.targetMaxChars).toBeLessThanOrEqual(180);
    expect(plan.worldview.mode).not.toBe("pending");
  });

  it("invite 且 COMPANION 允许一个问题并写入 mustDo", () => {
    const plan = planFor("想听听你怎么想");
    expect(plan.responseBudget.maxQuestions).toBe(1);
    expect(plan.questionPreference).toBe("invite");
    expect(plan.mustDo[0]).toContain("invite");
  });

  it("CLOSE 策略压缩篇幅", () => {
    const plan = planFor("我先睡了，改天聊");
    expect(plan.responseMode).toBe("CLOSE");
    expect(plan.responseBudget.targetMaxChars).toBeLessThanOrEqual(60);
  });

  it("用户把话题权交给 ZHAKA 时要求贡献内容", () => {
    const plan = planFor("你说点什么吧，聊点怪的");
    expect(plan.responseMode).toBe("COMPANION");
    expect(plan.responseBudget.maxQuestions).toBe(0);
    expect(plan.mustDo.some((line) => line.includes("主动贡献"))).toBe(true);
    expect(plan.mustAvoid.some((line) => line.includes("丢回"))).toBe(true);
  });

  it("很闲没话题时走短闲聊而不是安抚篇幅", () => {
    const plan = planFor("我也不知道聊什么，我现在很闲");
    expect(plan.responseMode).toBe("COMPANION");
    expect(plan.responseBudget.targetMaxChars).toBeLessThanOrEqual(90);
    expect(plan.mustAvoid.some((line) => line.includes("许可式"))).toBe(true);
  });
});
