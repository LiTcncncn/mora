import { z } from "zod";
import {
  energyLevelSchema,
  finishReasonSchema,
  idSchema,
  isoDateTimeSchema,
  recordedProviderIdSchema,
  runModeSchema,
  runStatusSchema,
  tokenUsageSchema,
} from "./common";
import { fewShotSelectionTraceSchema } from "./fewshot";
import { memorySelectionTraceSchema } from "./memory";
import { contextSectionIdSchema } from "./prompt";
import {
  contextSettingsSchema,
  energySettingsSchema,
  memorySettingsSchema,
  providerSettingsSchema,
} from "./settings";

export const appliedParameterSchema = z.object({
  name: z.string(),
  requestedValue: z.unknown(),
  appliedValue: z.unknown(),
  status: z.enum(["applied", "transformed", "not_applied"]),
  reason: z.string().optional(),
});
export type AppliedParameter = z.infer<typeof appliedParameterSchema>;

/** 显式挑选允许进入快照的字段，绝不 spread 整个运行时配置。 */
export const commonSettingsSnapshotSchema = z.object({
  energy: energySettingsSchema,
  memory: memorySettingsSchema,
  context: contextSettingsSchema,
  activePersonaId: idSchema,
  activePromptPresetId: idSchema,
});
export type CommonSettingsSnapshot = z.infer<
  typeof commonSettingsSnapshotSchema
>;

export const settingsSnapshotSchema = z.object({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  common: commonSettingsSnapshotSchema,
  provider: providerSettingsSchema,
  personaVersion: z.string(),
  promptPresetVersion: z.number().int().positive(),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const contextSectionSnapshotSchema = z.object({
  id: z.union([contextSectionIdSchema, z.literal("user_input")]),
  title: z.string(),
  content: z.string(),
  charCount: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative().nullable(),
  sourceIds: z.array(z.string()),
});
export type ContextSectionSnapshot = z.infer<
  typeof contextSectionSnapshotSchema
>;

export const contextSnapshotSchema = z.object({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  modelSlotId: idSchema,
  sections: z.array(contextSectionSnapshotSchema),
  renderedInstructions: z.string(),
  renderedInput: z.string(),
  selectedMemoryIds: z.array(idSchema),
  memorySelectionTrace: z.array(memorySelectionTraceSchema),
  // 早于 few-shot 模块的历史 run 没有这些字段。
  selectedFewShotIds: z.array(idSchema).default([]),
  fewShotSelectionTrace: z.array(fewShotSelectionTraceSchema).default([]),
  energy: z.object({
    level: energyLevelSchema,
    source: z.enum(["manual", "rule_based", "override", "llm"]),
    reason: z.string(),
  }),
  charCount: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative().nullable(),
  /** 不含槽位独立 assistant 历史的共享部分 hash。 */
  sharedHash: z.string(),
  /** 当前槽位完整有效 Context 的 hash（laneContextHash）。 */
  hash: z.string(),
});
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export const policyDeviationSchema = z.object({
  targetMaxChars: z.number().int(),
  actualChars: z.number().int(),
  targetMaxSentences: z.number().int(),
  actualSentences: z.number().int(),
  maxQuestions: z.number().int(),
  actualQuestions: z.number().int(),
  withinTarget: z.boolean(),
});
export type PolicyDeviation = z.infer<typeof policyDeviationSchema>;

export const runRecordSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  modelSlotId: idSchema.nullable(),
  slotLabel: z.string().max(60).nullable(),
  comparisonGroupId: idSchema.nullable(),
  comparisonRunIds: z.array(idSchema),
  conversationId: idSchema,
  userMessageId: idSchema,
  assistantMessageId: idSchema.nullable(),
  mode: runModeSchema,
  status: runStatusSchema,
  provider: recordedProviderIdSchema,
  modelId: z.string().max(120),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  timeToFirstTokenMs: z.number().int().nonnegative().nullable(),
  settingsSnapshot: settingsSnapshotSchema,
  contextSnapshot: contextSnapshotSchema,
  sharedContextHash: z.string(),
  contextHash: z.string(),
  appliedParameters: z.array(appliedParameterSchema),
  outputText: z.string().nullable(),
  usage: tokenUsageSchema,
  estimatedCost: z.object({
    amount: z.number().nonnegative().nullable(),
    currency: z.literal("USD"),
    isEstimate: z.literal(true),
    pricingLabel: z.string().nullable(),
    effectiveDate: z.string().nullable(),
  }),
  providerResponseId: z.string().nullable(),
  finishReason: finishReasonSchema.nullable(),
  policyDeviation: policyDeviationSchema.nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const runsDataSchema = z.object({
  items: z.array(runRecordSchema),
});
export type RunsData = z.infer<typeof runsDataSchema>;

export type RunSummary = Pick<
  RunRecord,
  | "id"
  | "profileId"
  | "modelSlotId"
  | "slotLabel"
  | "comparisonGroupId"
  | "conversationId"
  | "mode"
  | "status"
  | "provider"
  | "modelId"
  | "startedAt"
  | "completedAt"
  | "latencyMs"
  | "usage"
  | "estimatedCost"
  | "finishReason"
  | "contextHash"
  | "sharedContextHash"
  | "error"
>;

export function toRunSummary(run: RunRecord): RunSummary {
  return {
    id: run.id,
    profileId: run.profileId,
    modelSlotId: run.modelSlotId,
    slotLabel: run.slotLabel,
    comparisonGroupId: run.comparisonGroupId,
    conversationId: run.conversationId,
    mode: run.mode,
    status: run.status,
    provider: run.provider,
    modelId: run.modelId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    latencyMs: run.latencyMs,
    usage: run.usage,
    estimatedCost: run.estimatedCost,
    finishReason: run.finishReason,
    contextHash: run.contextHash,
    sharedContextHash: run.sharedContextHash,
    error: run.error,
  };
}
