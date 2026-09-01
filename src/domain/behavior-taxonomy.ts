import { z } from "zod";
import { energyLevelSchema } from "./common";

/**
 * 行为路由 v2 的枚举集合（§7、§5、§9）。
 *
 * 这些枚举由 `taxonomyVersion` 覆盖，只能随代码发布，不在 Lab 内编辑（§13.5）。
 * 单独成文件的原因是策略、种子、示例卡三处都要引用它们，放进任一处都会造成
 * 循环 import。
 */

/** §7.3：八种回复策略。顺序即 Lab 内的展示顺序。 */
export const responseModeSchema = z.enum([
  "COMPANION",
  "ASK_LIGHT",
  "DIRECT_ANSWER",
  "ONE_STEP_HELP",
  "CONFIRM_CHOICE",
  "CELEBRATE",
  "REPAIR",
  "CLOSE",
]);
export type ResponseMode = z.infer<typeof responseModeSchema>;

export const RESPONSE_MODES = responseModeSchema.options;

/** §7.4：用户对被提问的态度。 */
export const questionPreferenceSchema = z.enum(["invite", "neutral", "avoid"]);
export type QuestionPreference = z.infer<typeof questionPreferenceSchema>;

export const QUESTION_PREFERENCES = questionPreferenceSchema.options;

/** §9.2：世界观与本轮的关系。`required` 表示用户明确追问设定。 */
export const worldviewRelationSchema = z.enum([
  "required",
  "eligible",
  "discouraged",
]);
export type WorldviewRelation = z.infer<typeof worldviewRelationSchema>;

/**
 * §9.1：世界观强度。
 * W0 不渲染世界观分区；W1/W2 渲染一颗种子；W3 渲染 Canon Facts。
 */
export const worldviewModeSchema = z.enum(["W0", "W1", "W2", "W3"]);
export type WorldviewMode = z.infer<typeof worldviewModeSchema>;

export const WORLDVIEW_MODES = worldviewModeSchema.options;

/**
 * 种子可声明的强度只有 W1/W2（§9.8）。
 * W0 是「不出现」，W3 走 Canon Facts 而不走种子，两者都不该出现在种子上。
 */
export const organicWorldviewModeSchema = z.enum(["W1", "W2"]);
export type OrganicWorldviewMode = z.infer<typeof organicWorldviewModeSchema>;

/**
 * §8.3：Turn Plan 编译中途允许的未定状态。
 * 基础 Turn Plan 在第 8 步生成时还没选出种子，`mode` 只能是 `pending`；
 * 到第 14 步回填，第 16 步起不得再为 `pending`（§14）。
 */
export const plannedWorldviewModeSchema = z.union([
  worldviewModeSchema,
  z.literal("pending"),
]);
export type PlannedWorldviewMode = z.infer<typeof plannedWorldviewModeSchema>;

/** §5.2：重大负面事件类型。 */
export const majorEventTypeSchema = z.enum([
  "relationship_loss",
  "work_or_school_loss",
  "death_or_grief",
  "serious_health_event",
  "family_or_life_upheaval",
  "major_financial_loss",
  "other_major_loss",
]);
export type MajorEventType = z.infer<typeof majorEventTypeSchema>;

export const MAJOR_EVENT_TYPES = majorEventTypeSchema.options;

/** §5.3：事件主体。区分本人与转述他人，决定首轮反应的强度。 */
export const majorEventSubjectSchema = z.enum([
  "user",
  "close_other",
  "other",
]);
export type MajorEventSubject = z.infer<typeof majorEventSubjectSchema>;

/** §5.4：已经发生与正在发生要分开，「担心发生」不算命中。 */
export const majorEventTemporalStatusSchema = z.enum(["occurred", "ongoing"]);
export type MajorEventTemporalStatus = z.infer<
  typeof majorEventTemporalStatusSchema
>;

export const majorEventResolutionSchema = z.object({
  matched: z.boolean(),
  type: majorEventTypeSchema.nullable(),
  temporalStatus: majorEventTemporalStatusSchema.nullable(),
  subject: majorEventSubjectSchema.nullable(),
  evidence: z.array(z.string().max(400)).max(20),
}).strict();
export type MajorEventResolution = z.infer<typeof majorEventResolutionSchema>;

/** §6.1：Safety 判定结果。第一版是确定性规则层，不调用 LLM。 */
export const safetyLevelSchema = z.enum(["none", "concern", "urgent"]);
export type SafetyLevel = z.infer<typeof safetyLevelSchema>;

export const safetyRouteSchema = z.enum([
  "normal",
  "clarify_safety",
  "urgent_support",
]);
export type SafetyRoute = z.infer<typeof safetyRouteSchema>;

/**
 * §7.9：请求标志（D55）。
 *
 * 不是新的路由维度，而是把「用户是否明确要求详细回答/多步方案」这件事
 * 从 Turn Plan Compiler 里挪到 Router 输出。编译器必须是确定性的，
 * 不能临时理解用户原文（§8.4、§8.6）。
 */
export const requestFlagsSchema = z.object({
  wantsDetailedAnswer: z.boolean(),
  wantsMultiStepPlan: z.boolean(),
}).strict();
export type RequestFlags = z.infer<typeof requestFlagsSchema>;

/** Router 失败或规则未命中时的兜底：两个标志都不成立（§7.9）。 */
export const DEFAULT_REQUEST_FLAGS: RequestFlags = {
  wantsDetailedAnswer: false,
  wantsMultiStepPlan: false,
};

/** 标志来源，写入 Inspector 用于解释本轮篇幅为何放宽（§16.1）。 */
export const requestFlagSourceSchema = z.enum(["rule", "model", "fallback"]);
export type RequestFlagSource = z.infer<typeof requestFlagSourceSchema>;

/**
 * §12.4 / §9.5.4：世界观未能落地的原因。
 * 四个世界观状态字段之一，缺了它无法区分「没调度」与「调度了但没进 Prompt」。
 */
export const worldviewDropReasonSchema = z.enum([
  "not_scheduled",
  "no_candidate_after_mode_filter",
  "budget_trimmed",
  "model_ignored",
  "strategy_disallowed",
]);
export type WorldviewDropReason = z.infer<typeof worldviewDropReasonSchema>;

/** §9.8 / §11.2：内容资产共用的 Energy 覆盖范围，至少要覆盖一档。 */
export const energyRangeSchema = z.array(energyLevelSchema).min(1).max(4);
