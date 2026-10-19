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
import type { Persona } from "@/domain/persona";
import type { PromptPreset } from "@/domain/prompt";
import type { ContextSnapshot, RunRecord, SettingsSnapshot } from "@/domain/run";
import type {
  GenerationOverrides,
  ModelSlot,
  SettingsData,
} from "@/domain/settings";
import { getAdapter } from "../adapters/registry";
import { UNAVAILABLE_USAGE } from "../adapters/types";
import { AppError } from "../api/errors";
import { buildContext, measureTurnPlanDeviation } from "../context/builder";
import {
  extractMemoryCandidates,
  priorContextBeforeUserMessage,
} from "../memory/candidate-extractor";
import { prepareSharedTurnContext, applyBehaviorTraceAfterContext } from "./prepare-turn";
import { sanitizeForSpeech } from "../speech/sanitize-for-speech";
import {
  conversationRepository,
  memoryRepository,
  personaRepository,
  profileRepository,
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
    /** clientPersist 时回传完整候选，供浏览器写入 */
    candidates?: MemoryItem[];
  };
  /** 生效配置指纹，供前端提示「配置已更新」 */
  configHash?: string;
}

export interface CompareInput {
  profileId: string;
  conversationId: string;
  userMessage: string;
  energyOverride?: EnergyLevel | undefined;
  slotOverrides?:
    | Array<{ modelSlotId: string; generation?: GenerationOverrides }>
    | undefined;
  /** guest：不写服务器对话/runs/memories，上下文由客户端提供 */
  clientPersist?: boolean;
  clientMessages?: ConversationMessage[];
  clientMemories?: MemoryItem[];
  /** 强制记忆自动写入语义（guest）：抽取后直接当 active 返回 */
  forceAutoMemoryWrite?: boolean;
  actor?: { userId: string; role: string };
}

export function mergeGeneration(
  settings: SettingsData,
  slot: ModelSlot,
  override: GenerationOverrides | undefined,
): SettingsData["providers"][ProviderId]["generation"] {
  const base = settings.providers[slot.provider].generation;
  return { ...base, ...slot.generationOverrides, ...(override ?? {}) };
}

export function buildSettingsSnapshot(input: {
  settings: SettingsData;
  slot: ModelSlot;
  generation: SettingsData["providers"][ProviderId]["generation"];
  persona: Persona;
  promptPreset: PromptPreset;
  createdAt: string;
}): SettingsSnapshot {
  const { settings, slot } = input;
  return {
    id: `snap-${randomUUID()}`,
    createdAt: input.createdAt,
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
      generation: input.generation,
    },
    personaVersion: input.persona.updatedAt,
    promptPresetVersion: input.promptPreset.version,
  };
}

export async function runCompare(input: CompareInput): Promise<CompareResult> {
  const { profileId, conversationId, userMessage } = input;
  const clientPersist = Boolean(input.clientPersist);

  if (!userMessage.trim()) {
    throw new AppError("VALIDATION_ERROR", "消息不能为空");
  }

  const settings = await settingsRepository.get(profileId);
  const enabledSlots = settings.compare.modelSlots.filter((slot) => slot.enabled);
  if (enabledSlots.length === 0) {
    throw new AppError("VALIDATION_ERROR", "至少需要启用一个模型槽位");
  }

  const [profile, persona, promptPreset, serverMemories, serverConversation] =
    await Promise.all([
      profileRepository.requireProfile(profileId),
      personaRepository.get(profileId, settings.activePersonaId),
      promptPresetRepository.get(profileId, settings.activePromptPresetId),
      clientPersist
        ? Promise.resolve([] as MemoryItem[])
        : memoryRepository.list(profileId),
      clientPersist
        ? Promise.resolve(null)
        : conversationRepository.get(profileId, conversationId),
    ]);

  const memories = clientPersist
    ? (input.clientMemories ?? [])
    : serverMemories;

  const conversation = clientPersist
    ? {
        id: conversationId,
        profileId,
        title: "本地对话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: input.clientMessages ?? [],
      }
    : serverConversation!;

  const primarySlot = enabledSlots[0]!;

  const sharedTurn = await prepareSharedTurnContext({
    profileId,
    profileName: profile.name,
    userMessage,
    conversation,
    modelSlotId: primarySlot.id,
    settings: {
      memory: settings.memory,
      energy: settings.energy,
    },
    memories,
    energyOverride: input.energyOverride,
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
  if (!clientPersist) {
    await conversationRepository.mutate(profileId, conversationId, (current) => ({
      ...current,
      messages: [...current.messages, userMessageRecord],
    }));
  }

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
      conversation,
      persona,
      turnPlan: sharedTurn.turnPlan,
      behaviorConfig: sharedTurn.behaviorConfig,
      energyResolution: sharedTurn.energyResolution,
      selectedMemories: sharedTurn.selectedMemories,
      memoryTrace: sharedTurn.memoryTrace,
      memoryTimeWindowLabel: sharedTurn.memoryTimeWindowLabel,
      promptPreset,
      settings: {
        context: settings.context,
        memory: settings.memory,
      },
    });
    return {
      slot,
      generation,
      contextSnapshot: {
        ...contextSnapshot,
        turnRoutingSource: sharedTurn.routing.source,
      },
    };
  });

  const sharedContextHash = prepared[0]!.contextSnapshot.sharedHash;

  const finalBehaviorTrace = applyBehaviorTraceAfterContext({
    behaviorTrace: sharedTurn.behaviorTrace,
    turnPlan: sharedTurn.turnPlan,
    renderedInstructions: prepared[0]!.contextSnapshot.renderedInstructions,
  });

  const settingsSnapshotFor = (slot: ModelSlot): SettingsSnapshot =>
    buildSettingsSnapshot({
      settings,
      slot,
      generation: mergeGeneration(settings, slot, overrideBySlot.get(slot.id)),
      persona,
      promptPreset,
      createdAt: startedAt,
    });

  const runIds = prepared.map(() => `run-${randomUUID()}`);

  const settled = sharedTurn.urgentReply
    ? prepared.map(({ slot }) => ({
        status: "fulfilled" as const,
        value: {
          provider: slot.provider,
          modelId: slot.modelId,
          responseId: null,
          text: sharedTurn.urgentReply as string,
          usage: UNAVAILABLE_USAGE,
          latencyMs: 0,
          appliedParameters: [],
          finishReason: "completed" as const,
        },
      }))
    : await Promise.allSettled(
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

    if (outcome.status === "fulfilled") {
      const result = outcome.value;
      const assistantMessageId = `msg-${randomUUID()}`;
      // Run 保留供应商原文；对话气泡 / 未来 TTS 只用可播报正文。
      const spoken = sanitizeForSpeech(result.text);

      assistantMessages.push({
        id: assistantMessageId,
        role: "assistant",
        content: spoken.text,
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
        providerResponseId: result.responseId,
        finishReason: result.finishReason,
        policyDeviation: measureTurnPlanDeviation(
          result.text,
          sharedTurn.turnPlan,
        ),
        behaviorTrace: finalBehaviorTrace,
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
        text: spoken.text,
        displayText: spoken.text,
        finishReason: result.finishReason,
        usage: result.usage,
        latencyMs: result.latencyMs,
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
      providerResponseId: null,
      finishReason: null,
      policyDeviation: null,
      behaviorTrace: finalBehaviorTrace,
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
      assistantMessageId: null,
      error: { code: appError.code, message: appError.message },
    });
  });

  if (!clientPersist) {
    if (assistantMessages.length > 0) {
      await conversationRepository.mutate(profileId, conversationId, (current) => ({
        ...current,
        messages: [...current.messages, ...assistantMessages],
        worldviewScheduleState: sharedTurn.worldviewScheduleStateCommit,
      }));
    } else {
      await conversationRepository.mutate(profileId, conversationId, (current) => ({
        ...current,
        worldviewScheduleState: sharedTurn.worldviewScheduleStateCommit,
      }));
    }

    await runRepository.appendMany(runs, settings.logging.maxRuns);
    await memoryRepository.markUsed(profileId, [...usedMemoryIds]);
  }

  const memoryExtraction = await runMemoryExtraction({
    profileId,
    conversationId,
    userMessageId,
    userMessage,
    priorMessages: conversation.messages,
    settings,
    clientPersist,
    forceAutoMemoryWrite: Boolean(input.forceAutoMemoryWrite),
  });

  if (input.actor) {
    const { appendUsageLog } = await import("../auth/usage-log");
    for (const candidate of candidates) {
      await appendUsageLog({
        userId: input.actor.userId,
        role: input.actor.role,
        event: "compare_slot",
        provider: candidate.provider,
        modelId: candidate.modelId,
        ok: candidate.status === "succeeded",
        latencyMs: candidate.latencyMs,
        promptTokens: candidate.usage.inputTokens,
        completionTokens: candidate.usage.outputTokens,
      });
    }
  }

  return {
    comparisonGroupId,
    sharedContextHash,
    userMessageId,
    candidates,
    memoryExtraction,
    configHash: sharedTurn.behaviorTrace.behaviorConfigHash,
  };
}

/**
 * 自动记忆提取：与聊天同轮触发，不需要用户点击。
 * 抽取对象仍是用户原话；本轮开口之前的对话只用于解开指代。
 * 失败只显示“调用失败”，不影响各模型容器结果。
 */
export async function runMemoryExtraction(input: {
  profileId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  priorMessages: ConversationMessage[];
  settings: SettingsData;
  clientPersist?: boolean;
  forceAutoMemoryWrite?: boolean;
}): Promise<CompareResult["memoryExtraction"]> {
  const { settings } = input;
  if (!settings.memory.autoCandidateExtraction.enabled) {
    return { status: "disabled", candidateIds: [], displayText: "" };
  }

  try {
    const provider = settings.memory.autoCandidateExtraction.provider;
    let candidates: MemoryItem[] = await extractMemoryCandidates({
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

    if (input.forceAutoMemoryWrite) {
      const now = new Date().toISOString();
      candidates = candidates.map((item) => ({
        ...item,
        status: "active" as const,
        updatedAt: now,
      }));
    }

    if (!input.clientPersist) {
      await memoryRepository.createMany(candidates);
    }

    return {
      status: "succeeded",
      candidateIds: candidates.map((candidate) => candidate.id),
      displayText: "",
      ...(input.clientPersist ? { candidates } : {}),
    };
  } catch {
    return { status: "failed", candidateIds: [], displayText: CALL_FAILED_TEXT };
  }
}
