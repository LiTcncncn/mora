import { z } from "zod";
import { isoDateTimeSchema } from "./common";
import { fewShotSampleSchema } from "./fewshot";
import { personaSchema } from "./persona";
import { promptPresetSchema } from "./prompt";
import { settingsDataSchema } from "./settings";

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
   * 早于 few-shot 模块导出的配置文件没有这个字段。
   * 字段缺失表示“这份配置不管样本”，导入时保留现有样本；
   * 显式给空数组才表示清空。
   */
  fewShotSamples: z.array(fewShotSampleSchema).optional(),
});
export type MoraConfigBundle = z.infer<typeof moraConfigBundleSchema>;

export interface ConfigImportSummary {
  personaCount: number;
  promptPresetCount: number;
  /** null 表示该配置文件不含样本字段，导入后保留现有样本。 */
  fewShotSampleCount: number | null;
  modelSlots: Array<{ label: string; provider: string; modelId: string }>;
  sourceProfileName: string;
  exportedAt: string;
  replacesPersonaCount: number;
  replacesPromptPresetCount: number;
  replacesFewShotSampleCount: number;
}
