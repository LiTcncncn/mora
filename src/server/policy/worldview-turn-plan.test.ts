import { describe, expect, it } from "vitest";
import { turnPlanSchema } from "@/domain/turn-plan";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import { computeConfigHash } from "@/server/config/behavior-hash";
import { renderTurnPlanText } from "@/server/policy/render-turn-plan";
import {
  enrichTurnPlanWithWorldview,
  renderWorldviewExecutionBlock,
} from "@/server/policy/worldview-turn-plan";
import { compileTurnPlan } from "@/server/policy/turn-plan-compiler";
import { classifyTurnRules } from "@/server/router/fallback";
import { evaluateSafety } from "@/server/safety/evaluate";
import { finalizeBehaviorTurn } from "@/server/worldview/finalize-behavior-turn";

function config() {
  const base = buildDefaultBehaviorConfig("测试");
  return { ...base, configHash: computeConfigHash(base) };
}

describe("worldview turn plan", () => {
  it("W2 时追加雨林 mustDo 并渲染必须体现块", () => {
    const cfg = config();
    const safety = evaluateSafety("今天阴天，心里空落落的", cfg.safety);
    const routing = classifyTurnRules(
      {
        currentUserMessage: "今天阴天，心里空落落的",
        recentCanonicalMessages: [],
        previousEnergy: null,
        lastAssistantAskedQuestion: false,
        safetyResolution: safety,
      },
      cfg.requestFlags,
    );
    const basePlan = compileTurnPlan({ routing, config: cfg, safety });
    const finalized = finalizeBehaviorTurn({
      basePlan,
      routing,
      safety,
      config: cfg,
      conversation: {
        id: "conv-wv",
        profileId: "p1",
        title: "t",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        worldviewScheduleState: {
          scheduleSeed: "sched-test",
          schedulerAlgorithmVersion: "credit-v1",
          eligibleIndex: 2,
          credit: 1,
          rollingOutcomes: [false, false],
          eligibleTurnsSinceLastOrganic: 2,
          assistantTurnsSinceAnyWorldview: 2,
          recentSeedIds: [],
          lifetimeEligibleCount: 2,
          lifetimeOrganicCount: 0,
        },
      },
      userMessage: "今天阴天，心里空落落的",
    });

    const plan = finalized.turnPlan;
    expect(plan.mustDo.some((line) => line.includes("平行"))).toBe(true);
    expect(plan.selectedExampleId).toBeNull();

    const text = renderTurnPlanText(plan, cfg);
    expect(text).toContain("【本轮显性陪衬 · 融入情绪，不是介绍环境】");
    expect(text).toContain("雨前暗下来");
    expect(text).not.toContain("理想回复风格");
    expect(text).toContain("MORA");
  });

  it("W1/W2 注入后 turnPlan 仍通过 schema（mustDo/mustAvoid ≤10）", () => {
    const cfg = config();
    const safety = evaluateSafety("怎么办，好烦", cfg.safety);
    for (const responseMode of [
      "COMPANION",
      "ASK_LIGHT",
      "ONE_STEP_HELP",
      "CELEBRATE",
    ] as const) {
      const routing = classifyTurnRules(
        {
          currentUserMessage: "怎么办，好烦",
          recentCanonicalMessages: [],
          previousEnergy: "E2",
          lastAssistantAskedQuestion: false,
          safetyResolution: safety,
        },
        cfg.requestFlags,
      );
      routing.responseMode.value = responseMode;
      const basePlan = compileTurnPlan({ routing, config: cfg, safety });
      for (const mode of ["W1", "W2"] as const) {
        const enriched = enrichTurnPlanWithWorldview(
          {
            ...basePlan,
            worldview: {
              mode,
              source: "organic",
              seedId: "seed-rain-001",
              canonFactIds: [],
            },
          },
          cfg,
          "怎么办，好烦",
        );
        expect(turnPlanSchema.safeParse(enriched).success).toBe(true);
      }
    }
  });

  it("enrichTurnPlanWithWorldview 对 W0 无改动", () => {
    const cfg = config();
    const plan = enrichTurnPlanWithWorldview(
      {
        energy: "E2",
        responseMode: "COMPANION",
        questionPreference: "neutral",
        majorEvent: { matched: false, firstMention: false, type: null },
        responseBudget: {
          targetMinChars: 40,
          targetMaxChars: 140,
          hardMaxChars: 200,
          maxSentences: 3,
          maxQuestions: 0,
          maxActions: 0,
          providerMaxOutputTokens: 500,
        },
        mustDo: ["回应最具体、最重的部分"],
        mustAvoid: ["原因分析"],
        worldview: {
          mode: "W0",
          source: "none",
          seedId: null,
          canonFactIds: [],
        },
        selectedExampleId: null,
      },
      cfg,
    );
    expect(plan.mustDo).toHaveLength(1);
    expect(renderWorldviewExecutionBlock(plan, cfg)).toBeNull();
  });
});
