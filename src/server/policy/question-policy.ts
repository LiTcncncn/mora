import type { QuestionPolicySettings } from "@/domain/question-policy";
import type { QuestionPreference } from "@/domain/behavior-taxonomy";

/** 全产品写死：每轮回复最多一个问题。 */
export const HARD_MAX_QUESTIONS_PER_TURN = 1;

export const INVITE_QUESTION_MUST_DO =
  "用户邀请提问（Router invite）：必须问一个轻、具体、好答的问题，不可省略";

export const NEUTRAL_QUESTION_MUST_DO =
  "neutral 本轮必须问一个轻、具体、好答的问题，不可省略";

/** neutral 下按 questionPolicy 决定 0 或 1 问（仅二档，无「许可非必问」）。 */
export function resolveNeutralMaxQuestions(
  questionPolicy: QuestionPolicySettings,
  roll: () => number = Math.random,
): number {
  switch (questionPolicy.neutralMode) {
    case "never":
      return 0;
    case "must_ask":
      return HARD_MAX_QUESTIONS_PER_TURN;
    case "probabilistic":
      return roll() < questionPolicy.neutralMustAskProbability
        ? HARD_MAX_QUESTIONS_PER_TURN
        : 0;
  }
}

/**
 * 提问数唯一真相源：Router 提问偏好 + questionPolicy（neutral 分支）。
 * 不读取策略 mode、能量档或 Persona。
 */
export function compileMaxQuestions(input: {
  questionPreference: QuestionPreference;
  questionPolicy: QuestionPolicySettings;
  lastAssistantAskedQuestion: boolean;
  /** 测试注入；默认 Math.random */
  roll?: () => number;
}): number {
  const { questionPreference, questionPolicy, lastAssistantAskedQuestion } =
    input;

  if (questionPreference === "avoid") return 0;
  if (questionPreference === "invite") return HARD_MAX_QUESTIONS_PER_TURN;

  if (
    questionPolicy.suppressIfLastAssistantAsked &&
    lastAssistantAskedQuestion
  ) {
    return 0;
  }

  return resolveNeutralMaxQuestions(questionPolicy, input.roll);
}
