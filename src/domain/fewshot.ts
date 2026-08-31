import { z } from "zod";
import { energyLevelSchema, idSchema, isoDateTimeSchema } from "./common";

/**
 * 世界观级别：
 * - none 不含世界观，只示范口气与节奏
 * - L1 非人类体感，不点名雨林
 * - L2 显性雨林联想或朋友的小动作
 */
export const fewShotWorldviewSchema = z.enum(["none", "L1", "L2"]);
export type FewShotWorldview = z.infer<typeof fewShotWorldviewSchema>;

export const FEW_SHOT_WORLDVIEWS: readonly FewShotWorldview[] = [
  "none",
  "L1",
  "L2",
];

/** any 表示任何能量档位都可用。 */
export const fewShotEnergyScopeSchema = z.union([
  energyLevelSchema,
  z.literal("any"),
]);
export type FewShotEnergyScope = z.infer<typeof fewShotEnergyScopeSchema>;

export const FEW_SHOT_ENERGY_SCOPES: readonly FewShotEnergyScope[] = [
  "any",
  "E0",
  "E1",
  "E2",
  "E3",
];

export const fewShotSampleSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  /** 短场景标签，同时参与检索。 */
  scene: z.string().min(1).max(40),
  energy: fewShotEnergyScopeSchema,
  worldview: fewShotWorldviewSchema,
  keywords: z.array(z.string().min(1).max(40)).max(40),
  user: z.string().min(1).max(1000),
  /** 期望模型说出的样子，对应语料文档里的 yami 字段。 */
  reply: z.string().min(1).max(2000),
  /** 只给人看，不进提示词。 */
  note: z.string().max(500),
  enabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FewShotSample = z.infer<typeof fewShotSampleSchema>;

export const fewShotDataSchema = z.object({
  items: z.array(fewShotSampleSchema),
});
export type FewShotData = z.infer<typeof fewShotDataSchema>;

export const fewShotSelectionTraceSchema = z.object({
  sampleId: idSchema,
  scene: z.string(),
  worldview: fewShotWorldviewSchema,
  selected: z.boolean(),
  score: z.number(),
  reason: z.string(),
});
export type FewShotSelectionTrace = z.infer<typeof fewShotSelectionTraceSchema>;
