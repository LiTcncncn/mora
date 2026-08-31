import { z } from "zod";
import {
  energyRangeSchema,
  majorEventTypeSchema,
  organicWorldviewModeSchema,
  responseModeSchema,
} from "./behavior-taxonomy";
import { idSchema } from "./common";

/**
 * 世界观 v2 的内容资产与调度参数（§9.7、§9.8、§13.2）。
 *
 * 与 v1 的 `fewshot.ts` 的关键差别：显性世界观素材从示例语料里独立出来。
 * 旧结构用 `worldview: "L2"` 标在示例上，导致「示范怎么说话」和
 * 「提供什么世界观内容」两件事被同一条记录同时决定（§11.1）。
 */

/** §9.7：事实库。W3 回答先检索这里，不足时承认没想清楚，不临场编造。 */
export const canonFactCategorySchema = z.enum([
  "identity",
  "origin",
  "relationship",
  "preference",
  "experience",
  "boundary",
]);
export type CanonFactCategory = z.infer<typeof canonFactCategorySchema>;

export const worldviewCanonFactSchema = z.object({
  id: idSchema,
  category: canonFactCategorySchema,
  content: z.string().min(1).max(1000),
  /** 用户可能用来问同一件事的别名，参与 W3 检索。 */
  aliases: z.array(z.string().min(1).max(60)).max(20),
  enabled: z.boolean(),
  version: z.number().int().positive(),
}).strict();
export type WorldviewCanonFact = z.infer<typeof worldviewCanonFactSchema>;

/**
 * §9.8：情景种子。种子不是固定台词——主模型只收到 memory、attitude、
 * avoidClaims 与允许的强度，措辞由它自己组织。
 */
export const worldviewSeedSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).max(20),
  /** 什么情况下这颗种子贴题，参与检索的文本相关度。 */
  triggerDescription: z.string().min(1).max(500),
  memory: z.string().min(1).max(1000),
  attitude: z.string().min(1).max(500),
  allowedResponseModes: z.array(responseModeSchema).min(1),
  energyFit: energyRangeSchema,
  /** 只能是 W1/W2：W0 是不出现，W3 走 Canon Facts（§9.6）。 */
  allowedModes: z.array(organicWorldviewModeSchema).min(1).max(2),
  blockedMajorEventTypes: z.array(majorEventTypeSchema).max(10),
  avoidClaims: z.array(z.string().min(1).max(200)).max(10),
  /** 主题分组，用于 seedGroupNoConsecutive 判定（D44）。 */
  cooldownGroup: z.string().min(1).max(40),
  canonFactIds: z.array(idSchema).max(20),
  enabled: z.boolean(),
  version: z.number().int().positive(),
}).strict();
export type WorldviewSeed = z.infer<typeof worldviewSeedSchema>;

/**
 * §13.2：调度参数。
 *
 * 三个固定值用 literal 而不是 boolean/number：它们是算法前提而不是可调项，
 * §13.4 本就要求校验它们没被改动，用 literal 让 Zod 直接挡住。
 */
export const worldviewSettingsSchema = z.object({
  implicitAlwaysOn: z.literal(true),
  /** 新会话使用的算法版本；已创建的会话用自身固定的版本（§9.5.4）。 */
  schedulerAlgorithmVersion: z.string().min(1).max(40),
  /** 目标自然世界观占比，分母是合格轮次。 */
  organicTargetRate: z.number().min(0).max(0.5),
  /** 计数单位：合格轮次。 */
  rollingEligibleWindow: z.number().int().min(1).max(200),
  /** 计数单位：合格轮次。取 2 即相邻合格轮不得连续出现。 */
  minEligibleTurnsBetweenOrganic: z.number().int().min(0).max(100),
  /** 计数单位：合格轮次。连续这么多合格轮没有世界观则进入强制触发条件。 */
  maxEligibleTurnsBetweenOrganic: z.number().int().min(1).max(200),
  /** 计数单位：所有 assistant 轮次。约束 W3 到自然世界观的间隔。 */
  minAssistantTurnsBetweenAnyWorldview: z.number().int().min(0).max(5),
  countExplicitTowardOrganicRate: z.literal(false),
  maxSeedsPerReply: z.literal(1),
  /** 计数单位：所有 assistant 轮次。 */
  seedCooldownTurns: z.number().int().min(0).max(200),
  seedGroupNoConsecutive: z.literal(true),
  /** W2 中世界观内容占回复篇幅的比例上限。 */
  maxWorldviewShare: z.number().min(0).max(1),
  canonLint: z.object({
    forbiddenLegacyTerms: z.array(z.string().min(1).max(60)).max(500),
  }),
}).strict();
export type WorldviewSettings = z.infer<typeof worldviewSettingsSchema>;

/**
 * §3.2 / §3.3：已废弃设定的禁词表初始值。
 *
 * 旧出生地、品牌口号、海岸场景与非亚马逊物种。canon lint 命中这些词时，
 * 保存路径拒绝、导入路径把该条置为 enabled=false（§13.6.6）。
 */
export const DEFAULT_FORBIDDEN_LEGACY_TERMS: readonly string[] = [
  "哥斯达黎加",
  "甘多卡",
  "曼萨尼约",
  "加勒比",
  "潟湖",
  "瓜鲁莫树",
  "Pura Vida",
  "pura vida",
  "海滩",
  "沙滩",
  "海岸",
  "潮水",
  "涨潮",
  "退潮",
  "远洋",
  "大海",
  "海龟",
  "寄居蟹",
  "海鸥",
];

export function buildDefaultWorldviewSettings(): WorldviewSettings {
  return {
    implicitAlwaysOn: true,
    schedulerAlgorithmVersion: "credit-v1",
    organicTargetRate: 0.25,
    rollingEligibleWindow: 12,
    minEligibleTurnsBetweenOrganic: 2,
    maxEligibleTurnsBetweenOrganic: 6,
    minAssistantTurnsBetweenAnyWorldview: 1,
    countExplicitTowardOrganicRate: false,
    maxSeedsPerReply: 1,
    seedCooldownTurns: 12,
    seedGroupNoConsecutive: true,
    maxWorldviewShare: 0.34,
    canonLint: {
      forbiddenLegacyTerms: [...DEFAULT_FORBIDDEN_LEGACY_TERMS],
    },
  };
}
