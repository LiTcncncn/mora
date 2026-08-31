import { z } from "zod";
import {
  energyRangeSchema,
  majorEventTypeSchema,
  questionPreferenceSchema,
  responseModeSchema,
  type ResponseMode,
} from "./behavior-taxonomy";
import { idSchema } from "./common";

/**
 * §11：行为示例卡。
 *
 * 只示范「Turn Plan 已经确定后，这种策略怎样说得自然」。不再负责识别用户场景，
 * 也不再负责决定世界观是否出现——那两件事分别归 Router 与 Scheduler。
 */

/** §11.7：只有 approved 且 enabled 的卡片进入检索。 */
export const exampleReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type ExampleReviewStatus = z.infer<typeof exampleReviewStatusSchema>;

export const behaviorExampleCardSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  responseMode: responseModeSchema,
  energyRange: energyRangeSchema,
  questionPreferences: z.array(questionPreferenceSchema).min(1).max(3),
  majorEventCompatible: z.boolean(),
  majorEventTypes: z.array(majorEventTypeSchema).max(10),
  topicTags: z.array(z.string().min(1).max(40)).max(20),
  user: z.string().min(1).max(1000),
  /** 默认不含显性世界观——含世界观的旧回复要拆成一张卡加一颗种子（§11.2）。 */
  idealReply: z.string().min(1).max(2000),
  demonstrates: z.array(z.string().min(1).max(200)).max(10),
  /** §11.5：负面示例转成警告，只进离线评测与 Inspector，不进主模型上下文。 */
  evaluatorWarnings: z.array(z.string().min(1).max(200)).max(10),
  reviewStatus: exampleReviewStatusSchema,
  enabled: z.boolean(),
  version: z.number().int().positive(),
}).strict();
export type BehaviorExampleCard = z.infer<typeof behaviorExampleCardSchema>;

/**
 * §11.3：检索权重。四项硬过滤之外的软排序。
 * 权重之和必须为 1，否则打分不可比——§13.4 校验这一点。
 */
export const exampleRetrievalSettingsSchema = z.object({
  enabled: z.boolean(),
  /** §11.3：每轮最多选一张行为卡。 */
  maxCardsPerTurn: z.literal(1),
  /** 无高质量示例时不注入。错误示例比没有示例更糟。 */
  minScore: z.number().min(0).max(1),
  maxChars: z.number().int().min(0).max(20_000),
  weights: z.object({
    responseMode: z.number().min(0).max(1),
    energy: z.number().min(0).max(1),
    questionPreference: z.number().min(0).max(1),
    majorEvent: z.number().min(0).max(1),
    textRelevance: z.number().min(0).max(1),
  }),
}).strict();
export type ExampleRetrievalSettings = z.infer<
  typeof exampleRetrievalSettingsSchema
>;

export function buildDefaultExampleRetrievalSettings(): ExampleRetrievalSettings {
  return {
    enabled: true,
    maxCardsPerTurn: 1,
    minScore: 0.35,
    maxChars: 1500,
    weights: {
      responseMode: 0.45,
      energy: 0.15,
      questionPreference: 0.1,
      majorEvent: 0.15,
      textRelevance: 0.15,
    },
  };
}

/** §11.6：覆盖门槛。8 个 mode 各 ≥3，高频三档 ≥5。 */
export const MIN_CARDS_PER_MODE = 3;
export const MIN_CARDS_PER_HIGH_FREQUENCY_MODE = 5;
export const HIGH_FREQUENCY_MODES: readonly ResponseMode[] = [
  "COMPANION",
  "ONE_STEP_HELP",
  "DIRECT_ANSWER",
];
/** 每个 mode 的启用卡必须覆盖至少两个不同 Energy 档。 */
export const MIN_ENERGY_SPREAD_PER_MODE = 2;
/** questionPreference=avoid 的场景至少 2 张卡，跨 mode 计。 */
export const MIN_AVOID_CARDS = 2;

export function requiredCardCount(mode: ResponseMode): number {
  return HIGH_FREQUENCY_MODES.includes(mode)
    ? MIN_CARDS_PER_HIGH_FREQUENCY_MODE
    : MIN_CARDS_PER_MODE;
}

/** 进入检索的条件：approved 且 enabled（§11.7）。 */
export function isRetrievable(card: BehaviorExampleCard): boolean {
  return card.enabled && card.reviewStatus === "approved";
}
