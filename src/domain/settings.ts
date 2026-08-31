import { z } from "zod";
import { energyLevelSchema, idSchema, providerIdSchema } from "./common";
import { memoryTypeSchema } from "./memory";
import { contextSectionIdSchema } from "./prompt";

export const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const verbositySchema = z.enum(["low", "medium", "high"]);
export const thinkingModeSchema = z.enum(["enabled", "disabled"]);

export const generationSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).nullable(),
  topP: z.number().min(0).max(1).nullable(),
  maxOutputTokens: z.number().int().positive().max(200_000),
  presencePenalty: z.number().min(-2).max(2).nullable(),
  frequencyPenalty: z.number().min(-2).max(2).nullable(),
  seed: z.number().int().nullable(),
  thinkingMode: thinkingModeSchema.nullable(),
  reasoningEffort: reasoningEffortSchema.nullable(),
  verbosity: verbositySchema.nullable(),
});
export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

export const generationOverridesSchema = generationSettingsSchema.partial();
export type GenerationOverrides = z.infer<typeof generationOverridesSchema>;

export const providerSettingsSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().min(1).max(120),
  generation: generationSettingsSchema,
  transport: z.object({
    timeoutMs: z.number().int().min(1000).max(600_000),
    maxRetries: z.number().int().min(0).max(5),
    stream: z.literal(false),
  }),
  pricing: z.object({
    currency: z.literal("USD"),
    inputPerMillion: z.number().nonnegative().nullable(),
    cachedInputPerMillion: z.number().nonnegative().nullable(),
    outputPerMillion: z.number().nonnegative().nullable(),
    label: z.string().max(120),
    effectiveDate: z.string().max(40).nullable(),
  }),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const energyPolicySchema = z.object({
  targetMaxChars: z.number().int().positive().max(20_000),
  targetMaxSentences: z.number().int().positive().max(200),
  maxQuestions: z.number().int().min(0).max(20),
  maxSuggestedActions: z.number().int().min(0).max(20),
  allowAdvice: z.boolean(),
  validationWeight: z.number().min(0).max(1),
  actionWeight: z.number().min(0).max(1),
  toneInstruction: z.string().max(2000),
  responseInstruction: z.string().max(2000),
});
export type EnergyPolicy = z.infer<typeof energyPolicySchema>;

export const energySettingsSchema = z.object({
  mode: z.enum(["manual", "rule_based", "hybrid", "llm"]),
  manualLevel: energyLevelSchema,
  allowPerMessageOverride: z.boolean(),
  llmClassifier: z
    .object({
      provider: providerIdSchema,
      modelId: z.string().min(1).max(120),
    })
    .default({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
    }),
  ruleBased: z.object({
    enabled: z.boolean(),
    lowEnergyKeywords: z.array(z.string().min(1).max(40)).max(200),
    highEnergyKeywords: z.array(z.string().min(1).max(40)).max(200),
    exhaustionPunctuationWeight: z.number().min(0).max(1),
    shortMessageThreshold: z.number().int().min(1).max(500),
  }),
  policies: z.record(energyLevelSchema, energyPolicySchema),
});
export type EnergySettings = z.infer<typeof energySettingsSchema>;

export const memorySettingsSchema = z.object({
  enabled: z.boolean(),
  topK: z.number().int().min(0).max(50),
  maxChars: z.number().int().min(0).max(20_000),
  minImportance: z.number().min(0).max(1),
  includedTypes: z.array(memoryTypeSchema),
  weights: z.object({
    pinned: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    keywordRelevance: z.number().min(0).max(1),
  }),
  autoCandidateExtraction: z.object({
    enabled: z.boolean(),
    provider: providerIdSchema,
    modelId: z.string().min(1).max(120),
    requireManualApproval: z.boolean(),
  }),
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

const FEW_SHOT_DEFAULTS = {
  enabled: true,
  maxPerLevel: { E0: 1, E1: 2, E2: 2, E3: 3 },
  maxWorldviewPerTurn: 1,
  maxChars: 1500,
  minScore: 0.35,
} as const;

/**
 * 注入条数按能量档位分开：E0 只有 40 字 2 句的空间，
 * 塞多条上百字的示例会把回复长度带偏。
 */
export const fewShotSettingsSchema = z
  .object({
    enabled: z.boolean().default(FEW_SHOT_DEFAULTS.enabled),
    maxPerLevel: z
      .object({
        E0: z.number().int().min(0).max(10),
        E1: z.number().int().min(0).max(10),
        E2: z.number().int().min(0).max(10),
        E3: z.number().int().min(0).max(10),
      })
      .default(FEW_SHOT_DEFAULTS.maxPerLevel),
    /** 同一轮里带世界观的示例上限，防止示例整批都是雨林联想。 */
    maxWorldviewPerTurn: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(FEW_SHOT_DEFAULTS.maxWorldviewPerTurn),
    maxChars: z
      .number()
      .int()
      .min(0)
      .max(20_000)
      .default(FEW_SHOT_DEFAULTS.maxChars),
    /** 相关度下限：宁可不给示例，也不要给一条示范了别的行为的示例。 */
    minScore: z.number().min(0).max(5).default(FEW_SHOT_DEFAULTS.minScore),
  })
  .default(FEW_SHOT_DEFAULTS);
export type FewShotSettings = z.infer<typeof fewShotSettingsSchema>;

export const contextSettingsSchema = z.object({
  historyTurns: z.number().int().min(0).max(100),
  maxHistoryChars: z.number().int().min(0).max(200_000),
  maxTotalChars: z.number().int().min(500).max(500_000),
  includeTimestamps: z.boolean(),
  includeEnergyReason: z.boolean(),
  includeMemoryMetadata: z.boolean(),
  sectionOrder: z.array(contextSectionIdSchema),
  customExperimentBlockEnabled: z.boolean(),
  // 旧数据没有这一段，必须带默认值，否则历史 settings/runs 读取时校验失败。
  fewShot: fewShotSettingsSchema,
});
export type ContextSettings = z.infer<typeof contextSettingsSchema>;

export const loggingSettingsSchema = z.object({
  saveContextSnapshot: z.boolean(),
  saveSettingsSnapshot: z.boolean(),
  saveStandardizedProviderResponse: z.boolean(),
  saveRawProviderResponse: z.boolean(),
  maxRuns: z.number().int().min(10).max(20_000),
});
export type LoggingSettings = z.infer<typeof loggingSettingsSchema>;

export const evaluationSettingsSchema = z.object({
  enabled: z.literal(false),
  autoEvaluatorEnabled: z.literal(false),
});
export type EvaluationSettings = z.infer<typeof evaluationSettingsSchema>;

export const modelSlotSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(60),
  enabled: z.boolean(),
  provider: providerIdSchema,
  modelId: z.string().min(1).max(120),
  generationOverrides: generationOverridesSchema,
});
export type ModelSlot = z.infer<typeof modelSlotSchema>;

export const compareSettingsSchema = z.object({
  runInParallel: z.literal(true),
  historyMode: z.literal("independent_lanes"),
  modelSlots: z.array(modelSlotSchema).min(1).max(8),
});
export type CompareSettings = z.infer<typeof compareSettingsSchema>;

export const settingsDataSchema = z.object({
  activePersonaId: idSchema,
  activePromptPresetId: idSchema,
  defaultProvider: providerIdSchema,
  providers: z.object({
    kimi: providerSettingsSchema,
    deepseek: providerSettingsSchema,
  }),
  energy: energySettingsSchema,
  memory: memorySettingsSchema,
  context: contextSettingsSchema,
  logging: loggingSettingsSchema,
  evaluation: evaluationSettingsSchema,
  compare: compareSettingsSchema,
});
export type SettingsData = z.infer<typeof settingsDataSchema>;

export const profileSettingsItemSchema = z.object({
  profileId: idSchema,
  settings: settingsDataSchema,
});
export type ProfileSettingsItem = z.infer<typeof profileSettingsItemSchema>;

export const settingsStoreDataSchema = z.object({
  items: z.array(profileSettingsItemSchema),
});
export type SettingsStoreData = z.infer<typeof settingsStoreDataSchema>;
