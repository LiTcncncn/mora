import "server-only";
import { randomUUID } from "node:crypto";
import {
  CALL_FAILED_TEXT,
  type EnergyLevel,
  type FinishReason,
  type ProviderId,
  type TokenUsage,
} from "@/domain/common";
import type { ConversationMessage } from "@/domain/conversation";
import type { MemoryItem } from "@/domain/memory";
import type { ContextSnapshot, RunRecord, SettingsSnapshot } from "@/domain/run";
import type {
  GenerationOverrides,
  ModelSlot,
  SettingsData,
} from "@/domain/settings";
import { getAdapter } from "../adapters/registry";
import { UNAVAILABLE_USAGE } from "../adapters/types";
import { AppError } from "../api/errors";
import { buildContext } from "../context/builder";
import { measurePolicyDeviation, resolveEnergy } from "../energy/resolver";
import { selectFewShotSamples } from "../fewshot/selector";
import {
  extractMemoryCandidates,
  priorContextBeforeUserMessage,
} from "../memory/candidate-extractor";
import { selectMemories } from "../memory/selector";
import { estimateCost } from "../observability/cost";
import {
  conversationRepository,
  fewShotRepository,
  memoryRepository,
  personaRepository,
  promptPresetRepository,
  runRepository,
  settingsRepository,
} from "../persistence/repositories";

export interface CompareCandidate {
  modelSlotId: string;
  slotLabel: string;
  provider: ProviderId;
  modelId: string;
  runId: string;
  contextSnapshotId: string;
  laneContextHash: string;
  status: "succeeded" | "failed";
  /** 成功时为供应商完整原文；失败时必须为 null。 */
  text: string | null;
  /** 成功时等于完整 text；失败时严格为“调用失败”。 */
  displayText: string;
  finishReason: FinishReason | null;
  usage: TokenUsage;
  latencyMs: number | null;
  estimatedCost: number | null;
  assistantMessageId: string | null;
  error: { code: string; message: string } | null;
}

export interface CompareResult {
  comparisonGroupId: string;
  sharedContextHash: string;
  userMessageId: string;
  candidates: CompareCandidate[];
  memoryExtraction: {
    status: "succeeded" | "failed" | "disabled";
    candidateIds: string[];
    displayText: "" | typeof CALL_FAILED_TEXT;
  };
}

export interface CompareInput {
  profileId: string;
  conversationId: string;
  userMessage: string;
  energyOverride?: EnergyLevel | undefined;
  slotOverrides?:
    | Array<{ modelSlotId: string; generation?: GenerationOverrides }>
    | undefined;
}

function mergeGeneration(
  settings: SettingsData,
  slot: ModelSlot,
  override: GenerationOverrides | undefined,
): SettingsData["providers"][ProviderId]["generation"] {
  const base = settings.providers[slot.provider].generation;
  return { ...base, ...slot.generationOverrides, ...(override ?? {}) };
}

export async function runCompare(input: CompareInput): Promise<CompareResult> {
  const { profileId, conversationId, userMessage } = input;

  if (!userMessage.trim()) {
    throw new AppError("VALIDATION_ERROR", "消息不能为空");
  }

  const settings = await settingsRepository.get(profileId);
  const enabledSlots = settings.compare.modelSlots.filter((slot) => slot.enabled);
  if (enabledSlots.length === 0) {
    throw new AppError("VALIDATION_ERROR", "至少需要启用一个模型槽位");
  }

  const [persona, promptPreset, memories, fewShotSamples, conversation] =
    await Promise.all([
      personaRepository.get(profileId, settings.activePersonaId),
      promptPresetRepository.get(profileId, settings.activePromptPresetId),
      memoryRepository.list(profileId),
      fewShotRepository.list(profileId),
      conversationRepository.get(profileId, conversationId),
    ]);

  // 共享一次 Energy 与 Memory 解析，保证各槽位公平。
    const energyResolution = await resolveEnergy({
      userMessage,
      settings: settings.energy,
      override: input.energyOverride,
      timeoutMs:
        settings.providers[settings.energy.llmClassifier.provider].transport
          .timeoutMs,
    });
  const memorySelection = selectMemories({
    memories,
    userMessage,
    settings: settings.memory,
  });
  // Few-shot 与 Energy、Memory 一样只解析一次，各槽位共享同一批示例。
  const fewShotSelection = selectFewShotSamples({
    samples: fewShotSamples,
    userMessage,
    energyLevel: energyResolution.level,
    settings: settings.context.fewShot,
  });

  const comparisonGroupId = `cmp-${randomUUID()}`;
  const userMessageId = `msg-${randomUUID()}`;
  const startedAt = new Date().toISOString();

  const userMessageRecord: ConversationMessage = {
    id: userMessageId,
    role: "user",
    content: userMessage,
    createdAt: startedAt,
    runId: null,
    modelSlotId: null,
    provider: null,
    modelId: null,
    comparisonGroupId,
  };

  // 用户消息先落库：即使全部模型失败，用户输入也不会丢。
  await conversationRepository.mutate(profileId, conversationId, (current) => ({
    ...current,
    messages: [...current.messages, userMessageRecord],
  }));

  const overrideBySlot = new Map(
    (input.slotOverrides ?? []).map((item) => [item.modelSlotId, item.generation]),
  );
  for (const key of overrideBySlot.keys()) {
    if (!enabledSlots.some((slot) => slot.id === key)) {
      throw new AppError("VALIDATION_ERROR", `未知或未启用的模型槽位：${key}`);
    }
  }

  const prepared = enabledSlots.map((slot) => {
    const generation = mergeGeneration(
      settings,
      slot,
      overrideBySlot.get(slot.id),
    );
    const contextSnapshot = buildContext({
      modelSlotId: slot.id,
      userMessage,
      // 历史里不含本轮 user 消息，避免与当前输入重复。
      conversation,
      persona,
      energyResolution,
      selectedMemories: memorySelection.selected,
      memoryTrace: memorySelection.trace,
      selectedFewShotSamples: fewShotSelection.selected,
      fewShotTrace: fewShotSelection.trace,
      promptPreset,
      settings: {
        context: settings.context,
        memory: settings.memory,
        energy: settings.energy,
      },
    });
    return { slot, generation, contextSnapshot };
  });

  const sharedContextHash = prepared[0]!.contextSnapshot.sharedHash;

  const settingsSnapshotFor = (slot: ModelSlot): SettingsSnapshot => ({
    id: `snap-${randomUUID()}`,
    createdAt: startedAt,
    common: {
      energy: settings.energy,
      memory: settings.memory,
      context: settings.context,
      activePersonaId: settings.activePersonaId,
      activePromptPresetId: settings.activePromptPresetId,
    },
    provider: {
      ...settings.providers[slot.provider],
      modelId: slot.modelId,
      generation: mergeGeneration(settings, slot, overrideBySlot.get(slot.id)),
    },
    personaVersion: persona.updatedAt,
    promptPresetVersion: promptPreset.version,
  });

  const runIds = prepared.map(() => `run-${randomUUID()}`);

  const settled = await Promise.allSettled(
    prepared.map(async ({ slot, generation, contextSnapshot }, index) => {
      const adapter = getAdapter(slot.provider);
      const providerSettings = settings.providers[slot.provider];
      return adapter.complete({
        provider: slot.provider,
        modelId: slot.modelId,
        instructions: contextSnapshot.renderedInstructions,
        input: contextSnapshot.renderedInput,
        generation,
        timeoutMs: providerSettings.transport.timeoutMs,
        maxRetries: providerSettings.transport.maxRetries,
        metadata: {
          runId: runIds[index]!,
          conversationId,
          sharedContextHash,
          contextHash: contextSnapshot.hash,
        },
      });
    }),
  );

  const completedAt = new Date().toISOString();
  const candidates: CompareCandidate[] = [];
  const runs: RunRecord[] = [];
  const assistantMessages: ConversationMessage[] = [];
  const usedMemoryIds = new Set<string>();

  prepared.forEach(({ slot, contextSnapshot }, index) => {
    const runId = runIds[index]!;
    const outcome = settled[index]!;
    const snapshot: ContextSnapshot = contextSnapshot;
    const providerSettings = settings.providers[slot.provider];

    if (outcome.status === "fulfilled") {
      const result = outcome.value;
      const assistantMessageId = `msg-${randomUUID()}`;
      const cost = estimateCost(result.usage, providerSettings.pricing);

      assistantMessages.push({
        id: assistantMessageId,
        role: "assistant",
        // 完整原文，绝不截断或改写。
        content: result.text,
        createdAt: completedAt,
        runId,
        modelSlotId: slot.id,
        provider: slot.provider,
        modelId: slot.modelId,
        comparisonGroupId,
      });

      for (const memoryId of snapshot.selectedMemoryIds) {
        usedMemoryIds.add(memoryId);
      }

      runs.push({
        id: runId,
        profileId,
        modelSlotId: slot.id,
        slotLabel: slot.label,
        comparisonGroupId,
        comparisonRunIds: runIds.filter((id) => id !== runId),
        conversationId,
        userMessageId,
        assistantMessageId,
        mode: "compare",
        status: "succeeded",
        provider: slot.provider,
        modelId: slot.modelId,
        startedAt,
        completedAt,
        latencyMs: result.latencyMs,
        timeToFirstTokenMs: null,
        settingsSnapshot: settingsSnapshotFor(slot),
        contextSnapshot: snapshot,
        sharedContextHash,
        contextHash: snapshot.hash,
        appliedParameters: result.appliedParameters,
        outputText: result.text,
        usage: result.usage,
        estimatedCost: cost,
        providerResponseId: result.responseId,
        finishReason: result.finishReason,
        policyDeviation: measurePolicyDeviation(
          result.text,
          energyResolution.level,
          settings.energy,
        ),
        error: null,
      });

      candidates.push({
        modelSlotId: slot.id,
        slotLabel: slot.label,
        provider: slot.provider,
        modelId: slot.modelId,
        runId,
        contextSnapshotId: snapshot.id,
        laneContextHash: snapshot.hash,
        status: "succeeded",
        text: result.text,
        displayText: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        latencyMs: result.latencyMs,
        estimatedCost: cost.amount,
        assistantMessageId,
        error: null,
      });
      return;
    }

    const reason = outcome.reason;
    const appError =
      reason instanceof AppError
        ? reason
        : new AppError("UNKNOWN_ERROR", "调用失败");

    runs.push({
      id: runId,
      profileId,
      modelSlotId: slot.id,
      slotLabel: slot.label,
      comparisonGroupId,
      comparisonRunIds: runIds.filter((id) => id !== runId),
      conversationId,
      userMessageId,
      assistantMessageId: null,
      mode: "compare",
      status: "failed",
      provider: slot.provider,
      modelId: slot.modelId,
      startedAt,
      completedAt,
      latencyMs: null,
      timeToFirstTokenMs: null,
      settingsSnapshot: settingsSnapshotFor(slot),
      contextSnapshot: snapshot,
      sharedContextHash,
      contextHash: snapshot.hash,
      appliedParameters: [],
      outputText: null,
      usage: UNAVAILABLE_USAGE,
      estimatedCost: {
        amount: null,
        currency: "USD",
        isEstimate: true,
        pricingLabel: providerSettings.pricing.label || null,
        effectiveDate: providerSettings.pricing.effectiveDate,
      },
      providerResponseId: null,
      finishReason: null,
      policyDeviation: null,
      error: {
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
      },
    });

    candidates.push({
      modelSlotId: slot.id,
      slotLabel: slot.label,
      provider: slot.provider,
      modelId: slot.modelId,
      runId,
      contextSnapshotId: snapshot.id,
      laneContextHash: snapshot.hash,
      status: "failed",
      // 失败没有任何保底文本。
      text: null,
      displayText: CALL_FAILED_TEXT,
      finishReason: null,
      usage: UNAVAILABLE_USAGE,
      latencyMs: null,
      estimatedCost: null,
      assistantMessageId: null,
      error: { code: appError.code, message: appError.message },
    });
  });

  if (assistantMessages.length > 0) {
    await conversationRepository.mutate(profileId, conversationId, (current) => ({
      ...current,
      messages: [...current.messages, ...assistantMessages],
    }));
  }

  await runRepository.appendMany(runs, settings.logging.maxRuns);
  await memoryRepository.markUsed(profileId, [...usedMemoryIds]);

  const memoryExtraction = await runMemoryExtraction({
    profileId,
    conversationId,
    userMessageId,
    userMessage,
    priorMessages: conversation.messages,
    settings,
  });

  return {
    comparisonGroupId,
    sharedContextHash,
    userMessageId,
    candidates,
    memoryExtraction,
  };
}

/**
 * 自动记忆提取：与聊天同轮触发，不需要用户点击。
 * 抽取对象仍是用户原话；本轮开口之前的对话只用于解开指代。
 * 失败只显示“调用失败”，不影响各模型容器结果。
 */
async function runMemoryExtraction(input: {
  profileId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  priorMessages: ConversationMessage[];
  settings: SettingsData;
}): Promise<CompareResult["memoryExtraction"]> {
  const { settings } = input;
  if (!settings.memory.autoCandidateExtraction.enabled) {
    return { status: "disabled", candidateIds: [], displayText: "" };
  }

  try {
    const provider = settings.memory.autoCandidateExtraction.provider;
    const candidates: MemoryItem[] = await extractMemoryCandidates({
      profileId: input.profileId,
      conversationId: input.conversationId,
      userTexts: [
        { messageId: input.userMessageId, content: input.userMessage },
      ],
      priorContext: priorContextBeforeUserMessage(
        input.priorMessages,
        input.userMessageId,
      ),
      memorySettings: settings.memory,
      timeoutMs: settings.providers[provider].transport.timeoutMs,
    });
    await memoryRepository.createMany(candidates);
    return {
      status: "succeeded",
      candidateIds: candidates.map((candidate) => candidate.id),
      displayText: "",
    };
  } catch {
    return { status: "failed", candidateIds: [], displayText: CALL_FAILED_TEXT };
  }
}
