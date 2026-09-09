import { z } from "zod";
import { energyLevelSchema, idSchema, isoDateTimeSchema } from "./common";
import { personaSchema } from "./persona";
import { promptPresetSchema } from "./prompt";
import { settingsDataSchema } from "./settings";

/**
 * v1 配置包内嵌的旧 few-shot 样本格式。
 * 仅用于解析历史导出文件并在 v1→v2 迁移时转成行为示例卡候选。
 */
const legacyFewShotEnergyScopeSchema = z.union([
  energyLevelSchema,
  z.literal("any"),
]);

const legacyFewShotWorldviewSchema = z.enum(["none", "L1", "L2"]);

export const legacyFewShotSampleSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  scene: z.string().min(1).max(200),
  energy: legacyFewShotEnergyScopeSchema,
  worldview: legacyFewShotWorldviewSchema,
  keywords: z.array(z.string()).max(40),
  user: z.string().min(1).max(1000),
  reply: z.string().min(1).max(2000),
  note: z.string().max(500),
  enabled: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type LegacyFewShotSample = z.infer<typeof legacyFewShotSampleSchema>;

/**
 * 行为配置包：只含设置、Persona 与 Prompt Preset。
 * 绝不包含 API Key、环境变量、路径、对话、Memory、runs 或 profile id。
 */
export const moraConfigBundleSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("mora_behavior_config"),
  exportedAt: isoDateTimeSchema,
  sourceProfileName: z.string().min(1).max(80),
  settings: settingsDataSchema,
  personas: z.array(personaSchema),
  promptPresets: z.array(promptPresetSchema),
  /**
   * 旧版 few-shot 样本（已退役）。字段缺失表示「不管样本」；
   * 显式空数组表示「清空样本」；有内容则在 v2 迁移时转成示例卡候选。
   */
  fewShotSamples: z.array(legacyFewShotSampleSchema).optional(),
});
export type MoraConfigBundle = z.infer<typeof moraConfigBundleSchema>;

export interface ConfigImportSummary {
  personaCount: number;
  promptPresetCount: number;
  modelSlots: Array<{ label: string; provider: string; modelId: string }>;
  sourceProfileName: string;
  exportedAt: string;
  replacesPersonaCount: number;
  replacesPromptPresetCount: number;
}
