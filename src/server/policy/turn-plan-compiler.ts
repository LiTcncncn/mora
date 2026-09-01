import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { ResponseMode } from "@/domain/behavior-taxonomy";
import type { TurnPlan } from "@/domain/turn-plan";
import type { SafetyResolution, TurnRoutingResult } from "@/domain/turn-routing";
import {
  compileMaxQuestions,
  INVITE_QUESTION_MUST_DO,
} from "./question-policy";

const COMPANION_MAJOR_MODES: ResponseMode[] = ["COMPANION", "ASK_LIGHT"];

export function buildCompileNotes(input: {
  routing: import("@/domain/turn-routing").TurnRoutingResult;
  plan: TurnPlan;
  config: BehaviorConfigV2;
  safety: import("@/domain/turn-routing").SafetyResolution;
}): string[] {
  const notes: string[] = [];
  const { routing, plan, config, safety } = input;

  if (routing.requestFlags.wantsDetailedAnswer) {
    notes.push(
      `requestFlags.wantsDetailedAnswer=true（source=${routing.requestFlags.source}）`,
    );
  }
  if (routing.requestFlags.wantsMultiStepPlan) {
    notes.push("requestFlags.wantsMultiStepPlan=true（第一版只记录不生效）");
  }
  if (plan.majorEvent.firstMention) {
    notes.push(
      `重大事件首轮压缩：≤${config.majorEvent.firstMentionHardMaxChars} 字 / ${config.majorEvent.firstMentionMaxSentences} 句`,
    );
  }
  if (plan.responseMode === "CLOSE") {
    notes.push("CLOSE 策略附加篇幅压缩");
  }
  if (safety.level === "concern") {
    notes.push("Safety concern 附加篇幅压缩");
  }
  if (routing.questionPreference.value === "invite") {
    notes.push(
      plan.responseBudget.maxQuestions === 1
        ? "questionPreference=invite → 本轮必须问 1 个问题"
        : "questionPreference=invite 但本策略不允许 override → 仍为 0 问",
    );
  }
  if (routing.source === "fallback") {
    notes.push("Router 使用 fallback 结果");
  }
  if (plan.worldview.mode === "W1" || plan.worldview.mode === "W2") {
    notes.push(
      `世界观 ${plan.worldview.mode} 已注入种子 ${plan.worldview.seedId ?? "—"}（显性陪衬融入情绪）；示例卡已让位`,
    );
  }

  return notes;
}

/** §8.3–§8.6：确定性 Turn Plan 编译，不读用户原文。 */
export function compileTurnPlan(input: {
  routing: TurnRoutingResult;
  config: BehaviorConfigV2;
  safety: SafetyResolution;
  energyOverride?: import("@/domain/common").EnergyLevel;
  allowEnergyOverride?: boolean;
}): TurnPlan {
  const { routing, config, safety } = input;
  const energy =
    input.energyOverride && input.allowEnergyOverride
      ? input.energyOverride
      : routing.energy.level;

  const mode = routing.responseMode.value;
  const policy = config.strategies[mode];
  const budget = config.energy.budgets[energy];

  const questionPreference = routing.questionPreference.value;
  const maxQuestions = compileMaxQuestions(questionPreference, policy);

  let maxActions: number;
  if (mode === "ONE_STEP_HELP") {
    maxActions = 1;
  } else if (mode === "DIRECT_ANSWER") {
    maxActions = Math.min(policy.defaultMaxActions, budget.defaultMaxActions);
  } else {
    maxActions = 0;
  }

  let targetMinChars = budget.targetMinChars;
  let targetMaxChars = Math.round(
    budget.targetMaxChars * policy.lengthMultiplier,
  );
  const hardMaxChars = budget.hardMaxChars;
  let maxSentences = budget.maxSentences;

  if (
    routing.requestFlags.wantsDetailedAnswer &&
    energy === "E3" &&
    config.requestFlags.detailedAnswerEnabled
  ) {
    targetMaxChars = budget.hardMaxChars;
  }

  const firstMention =
    config.majorEvent.enabled &&
    routing.majorEvent.matched &&
    routing.majorEvent.temporalStatus === "occurred";

  if (firstMention && COMPANION_MAJOR_MODES.includes(mode)) {
    targetMaxChars = Math.min(
      targetMaxChars,
      config.majorEvent.firstMentionHardMaxChars,
    );
    maxSentences = Math.min(
      maxSentences,
      config.majorEvent.firstMentionMaxSentences,
    );
  }

  if (mode === "CLOSE") {
    targetMaxChars = Math.min(targetMaxChars, 60);
  }

  if (safety.level === "concern") {
    targetMaxChars = Math.min(targetMaxChars, 180);
    maxSentences = Math.min(maxSentences, 4);
  }

  targetMaxChars = Math.min(targetMaxChars, hardMaxChars);
  targetMinChars = Math.min(targetMinChars, targetMaxChars);

  const mustDo = [...policy.mustDo];
  if (questionPreference === "invite" && maxQuestions === 1) {
    mustDo.unshift(INVITE_QUESTION_MUST_DO);
  }

  return {
    energy,
    responseMode: mode,
    questionPreference,
    majorEvent: {
      matched: routing.majorEvent.matched,
      firstMention,
      type: routing.majorEvent.type,
    },
    responseBudget: {
      targetMinChars,
      targetMaxChars,
      hardMaxChars,
      maxSentences,
      maxQuestions,
      maxActions,
      providerMaxOutputTokens: budget.providerMaxOutputTokens,
    },
    mustDo,
    mustAvoid: [...policy.mustAvoid],
    worldview: {
      mode: "pending",
      source: "none",
      seedId: null,
      canonFactIds: [],
    },
    selectedExampleId: null,
  };
}
