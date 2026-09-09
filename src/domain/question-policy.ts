import { z } from "zod";

/**
 * neutral 下的提问决策（仅二档：必问 / 不许问）。
 * - never：一律不许问
 * - must_ask：一律必问
 * - probabilistic：按 neutralMustAskProbability 随机二选一
 */
export const neutralQuestionModeSchema = z.enum([
  "never",
  "must_ask",
  "probabilistic",
]);
export type NeutralQuestionMode = z.infer<typeof neutralQuestionModeSchema>;

export const questionPolicySettingsSchema = z
  .object({
    neutralMode: neutralQuestionModeSchema,
    /** probabilistic 时 neutral 必问概率（0–1）；不许问 = 1 - 此值。 */
    neutralMustAskProbability: z.number().min(0).max(1),
    /** 上一轮 assistant 已含问句时，neutral 强制 0 问，避免连续审问。 */
    suppressIfLastAssistantAsked: z.boolean(),
  })
  .strict();
export type QuestionPolicySettings = z.infer<
  typeof questionPolicySettingsSchema
>;

export function buildDefaultQuestionPolicy(): QuestionPolicySettings {
  return {
    neutralMode: "probabilistic",
    neutralMustAskProbability: 0.5,
    suppressIfLastAssistantAsked: true,
  };
}

/** 用户输入 0–100 的整数百分比，解析为 0–1 概率。非法输入回退 defaultPercent。 */
export function parseNeutralMustAskPercent(
  raw: string,
  defaultPercent = 50,
): number {
  const trimmed = raw.trim();
  if (!trimmed) return defaultPercent / 100;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return defaultPercent / 100;
  const clamped = Math.min(100, Math.max(0, parsed));
  return clamped / 100;
}

export function formatNeutralMustAskPercent(probability: number): string {
  return String(Math.round(probability * 100));
}

/** 保存前规范化，避免浮点漂移或未提交的中间态。 */
export function normalizeQuestionPolicyForSave(
  policy: QuestionPolicySettings,
): QuestionPolicySettings {
  if (policy.neutralMode !== "probabilistic") {
    return policy;
  }
  const percent = Math.round(policy.neutralMustAskProbability * 100);
  const clamped = Math.min(100, Math.max(0, percent));
  return {
    ...policy,
    neutralMustAskProbability: clamped / 100,
  };
}
