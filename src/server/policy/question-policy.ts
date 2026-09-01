import type { QuestionPreference } from "@/domain/behavior-taxonomy";
import type { StrategyPolicy } from "@/domain/strategy-policy";

/** 全产品写死：每轮回复最多一个问题。 */
export const HARD_MAX_QUESTIONS_PER_TURN = 1;

export const INVITE_QUESTION_MUST_DO =
  "用户邀请提问（Router invite）：必须问一个轻、具体、好答的问题，不可省略";

/**
 * 问题数仅由 Router 提问偏好 + 策略是否允许提问决定。
 * 不再读取能量档或 Lab 里的提问数配置。
 */
export function compileMaxQuestions(
  questionPreference: QuestionPreference,
  policy: Pick<StrategyPolicy, "defaultMaxQuestions" | "allowInviteOverride">,
): number {
  if (questionPreference === "avoid") return 0;
  if (questionPreference === "invite") {
    return policy.allowInviteOverride ? HARD_MAX_QUESTIONS_PER_TURN : 0;
  }
  return policy.defaultMaxQuestions > 0 ? HARD_MAX_QUESTIONS_PER_TURN : 0;
}
