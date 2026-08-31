import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export type ISODateTime = string;

export const providerIdSchema = z.enum(["kimi", "deepseek"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** 历史运行可能仍记录已停用的 OpenAI。 */
export const recordedProviderIdSchema = z.enum(["kimi", "deepseek", "openai"]);
export type RecordedProviderId = z.infer<typeof recordedProviderIdSchema>;

export const runModeSchema = z.enum(["single", "compare"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const runStatusSchema = z.enum(["pending", "succeeded", "failed"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const energyLevelSchema = z.enum(["E0", "E1", "E2", "E3"]);
export type EnergyLevel = z.infer<typeof energyLevelSchema>;

export const ENERGY_LEVELS: readonly EnergyLevel[] = ["E0", "E1", "E2", "E3"];

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable().optional(),
  reasoningTokens: z.number().int().nonnegative().nullable().optional(),
  source: z.enum(["provider", "estimated", "unavailable"]),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const finishReasonSchema = z.enum([
  "completed",
  "length",
  "content_filter",
  "cancelled",
  "unknown",
]);
export type FinishReason = z.infer<typeof finishReasonSchema>;

export const idSchema = z.string().min(1).max(200);

/** 失败时在 UI 正文区域显示的唯一允许文本。禁止任何其他保底话术。 */
export const CALL_FAILED_TEXT = "调用失败";
