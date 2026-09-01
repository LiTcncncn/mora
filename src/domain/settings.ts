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
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const energyPolicySchema = z.object({
  targetMaxChars: z.number().int().positive().max(20_000),
  targetMaxSentences: z.number().int().positive().max(200),
  maxQuestions: z.number().int().min(0).max(20),
  maxSuggestedActions: z.number().int().min(0).max(20),
  allowAdvice: z.boolean(),
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

export const contextSettingsSchema = z.object({
  historyTurns: z.number().int().min(0).max(100),
  maxHistoryChars: z.number().int().min(0).max(200_000),
  maxTotalChars: z.number().int().min(500).max(500_000),
  includeTimestamps: z.boolean(),
  includeEnergyReason: z.boolean(),
  includeMemoryMetadata: z.boolean(),
  sectionOrder: z.array(contextSectionIdSchema),
  customExperimentBlockEnabled: z.boolean(),
});
export type ContextSettings = z.infer<typeof contextSettingsSchema>;

/**
 * 上下文快照、设置快照、标准化响应一律无条件保存：Lab 的全部调试能力都建立在
 * 「每轮都能回看当时发生了什么」之上，可关掉就等于可以调出无法复现的运行记录。
 */
export const loggingSettingsSchema = z.object({
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
