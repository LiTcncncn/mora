import "server-only";
import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "@/domain/conversation";
import type { MemoryItem } from "@/domain/memory";
import type { RunRecord } from "@/domain/run";
import type { SettingsData } from "@/domain/settings";
import {
  VOICE_HAPTIC_MS,
  type VoiceId,
  type VoiceTimingMark,
  type VoiceTurnEvent,
  type VoiceTurnStage,
} from "@/domain/voice";
import { getAdapter } from "../adapters/registry";
import { UNAVAILABLE_USAGE, type UnifiedModelResult } from "../adapters/types";
import { AppError } from "../api/errors";
import { appendUsageLog } from "../auth/usage-log";
import { getMinimaxAsrModel, getMinimaxTtsModel, getSecretValues } from "../config/env";
import { buildContext, measureTurnPlanDeviation } from "../context/builder";
import { sanitizeText } from "../observability/sanitize";
import {
  conversationRepository,
  memoryRepository,
  personaRepository,
  profileRepository,
  promptPresetRepository,
  runRepository,
  settingsRepository,
} from "../persistence/repositories";
import { transcribeWav, synthesizeSpeech } from "../speech/minimax";
import {
  applyTtsPronunciations,
  cleanForSpeech,
  sanitizeForSpeech,
} from "../speech/sanitize-for-speech";
import { SentenceSegmenter } from "../speech/sentence-segmenter";
import { buildSettingsSnapshot, mergeGeneration, runMemoryExtraction } from "./compare";
import { applyBehaviorTraceAfterContext, prepareSharedTurnContext } from "./prepare-turn";

export interface VoiceTurnInput {
  profileId: string;
  conversationId: string;
  modelSlotId: string;
  voiceId: VoiceId;
  audio: Blob;
  /** guest：不写服务器对话/runs/memories，上下文由客户端提供 */
  clientPersist: boolean;
  clientMessages?: ConversationMessage[];
  clientMemories?: MemoryItem[];
  forceAutoMemoryWrite: boolean;
  actor: { userId: string; role: string };
  signal?: AbortSignal;
  /** 网关已经识别好的文本。有的话跳过 ASR。 */
  transcript?: string;
  /** 0 表示语音对话直接走规则层，不等网络 Router。undefined 表示不限。 */
  routerBudgetMs?: number;
}

const SPEAKABLE = /[\p{L}\p{N}]/u;

function compactVoiceContext(settings: {
  context: SettingsData["context"];
  memory: SettingsData["memory"];
}): Pick<SettingsData, "context" | "memory"> {
  return {
    context: {
      ...settings.context,
      historyTurns: Math.min(settings.context.historyTurns, 10),
      maxHistoryChars: Math.min(settings.context.maxHistoryChars, 3000),
      includeTimestamps: false,
      includeMemoryMetadata: false,
    },
    memory: {
      ...settings.memory,
      topK: Math.min(settings.memory.topK, 4),
    },
  };
}

export function voiceErrorEvent(stage: VoiceTurnStage, error: unknown): VoiceTurnEvent {
  const appError =
    error instanceof AppError ? error : new AppError("UNKNOWN_ERROR", "调用失败");
  return {
    type: "error",
    stage,
    code: appError.code,
    message: sanitizeText(appError.message, getSecretValues()),
  };
}

/**
 * 一轮语音对话：ASR → 与文字相同的陪伴管线 → 流式生成 → 逐句 TTS。
 * 与传输层无关，浏览器 HTTP 流与后续硬件网关共用。
 */
export async function runVoiceTurn(
  input: VoiceTurnInput,
  emit: (event: VoiceTurnEvent) => void,
): Promise<void> {
  const { profileId, conversationId, actor } = input;
  const settings = await settingsRepository.get(profileId);
  const slot = settings.compare.modelSlots.find(
    (item) => item.id === input.modelSlotId && item.enabled,
  );
  if (!slot) {
    throw new AppError("VALIDATION_ERROR", "所选模型槽位未启用");
  }

  const asrStartedAt = Date.now();
  let transcript: string;
  let asrLatencyMs: number;
  if (input.transcript != null) {
    transcript = input.transcript;
    asrLatencyMs = 0;
  } else {
    try {
      transcript = (await transcribeWav(input.audio, input.signal)).text;
    } catch (error) {
      if (input.signal?.aborted) return;
      await appendUsageLog({
        userId: actor.userId,
        role: actor.role,
        event: "voice_asr",
        provider: "minimax",
        modelId: getMinimaxAsrModel(),
        ok: false,
        latencyMs: Date.now() - asrStartedAt,
      });
      emit(voiceErrorEvent("asr", error));
      return;
    }
    asrLatencyMs = Date.now() - asrStartedAt;
  }
  const mark = (name: VoiceTimingMark): void => {
    emit({ type: "timing", mark: name, ms: Date.now() - asrStartedAt });
  };
  mark("asr");
  if (input.transcript == null) {
    await appendUsageLog({
      userId: actor.userId,
      role: actor.role,
      event: "voice_asr",
      provider: "minimax",
      modelId: getMinimaxAsrModel(),
      ok: true,
      latencyMs: asrLatencyMs,
    });
  }

  if (!SPEAKABLE.test(transcript)) {
    emit({ type: "empty" });
    return;
  }

  const [profile, persona, promptPreset, serverMemories, serverConversation] =
    await Promise.all([
      profileRepository.requireProfile(profileId),
      personaRepository.get(profileId, settings.activePersonaId),
      promptPresetRepository.get(profileId, settings.activePromptPresetId),
      input.clientPersist
        ? Promise.resolve([] as MemoryItem[])
        : memoryRepository.list(profileId),
      input.clientPersist
        ? Promise.resolve(null)
        : conversationRepository.get(profileId, conversationId),
    ]);

  const memories = input.clientPersist ? (input.clientMemories ?? []) : serverMemories;
  const conversation = input.clientPersist
    ? {
        id: conversationId,
        profileId,
        title: "本地对话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: input.clientMessages ?? [],
      }
    : serverConversation!;

  const voiceContext = compactVoiceContext(settings);
  const sharedTurn = await prepareSharedTurnContext({
    profileId,
    profileName: profile.name,
    userMessage: transcript,
    conversation,
    modelSlotId: slot.id,
    settings: { memory: voiceContext.memory, energy: settings.energy },
    memories,
    routerBudgetMs: input.routerBudgetMs,
  });
  mark("router");
  // 用户在识别期间接着说话时，网关会取消这一轮并把两段合起来重来，这里不能先存半句。
  if (input.signal?.aborted) return;

  const comparisonGroupId = `cmp-${randomUUID()}`;
  const userMessageId = `msg-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const userMessage: ConversationMessage = {
    id: userMessageId,
    role: "user",
    content: transcript,
    createdAt: startedAt,
    runId: null,
    modelSlotId: null,
    provider: null,
    modelId: null,
    comparisonGroupId,
  };

  if (!input.clientPersist) {
    await conversationRepository.mutate(profileId, conversationId, (current) => ({
      ...current,
      messages: [...current.messages, userMessage],
    }));
  }
  emit({ type: "transcript", text: transcript, userMessageId, comparisonGroupId });

  const contextSnapshot = {
    ...buildContext({
      modelSlotId: slot.id,
      userMessage: transcript,
      conversation,
      persona,
      turnPlan: sharedTurn.turnPlan,
      behaviorConfig: sharedTurn.behaviorConfig,
      energyResolution: sharedTurn.energyResolution,
      selectedMemories: sharedTurn.selectedMemories,
      memoryTrace: sharedTurn.memoryTrace,
      memoryTimeWindowLabel: sharedTurn.memoryTimeWindowLabel,
      promptPreset,
      settings: voiceContext,
    }),
    turnRoutingSource: sharedTurn.routing.source,
  };
  const behaviorTrace = applyBehaviorTraceAfterContext({
    behaviorTrace: sharedTurn.behaviorTrace,
    turnPlan: sharedTurn.turnPlan,
    renderedInstructions: contextSnapshot.renderedInstructions,
  });
  const generation = mergeGeneration(settings, slot, undefined);
  const runId = `run-${randomUUID()}`;

  let ttsChain: Promise<void> = Promise.resolve();
  let ttsFailed = false;
  let ttsStartedAt: number | null = null;
  let firstAudioAt: number | null = null;
  let hapticPending = sharedTurn.turnPlan.energy === "E1";
  const speak = (segment: string): void => {
    const text = cleanForSpeech(segment);
    if (!SPEAKABLE.test(text)) return;
    ttsChain = ttsChain.then(async () => {
      if (input.signal?.aborted) return;
      emit({ type: "text", text });
      if (ttsFailed) return;
      ttsStartedAt ??= Date.now();
      try {
        for await (const chunk of synthesizeSpeech({
          text: applyTtsPronunciations(text),
          voiceId: input.voiceId,
          signal: input.signal,
        })) {
          if (chunk.byteLength === 0) continue;
          if (firstAudioAt === null) {
            firstAudioAt = Date.now();
            mark("first_audio");
          }
          if (hapticPending) {
            hapticPending = false;
            emit({ type: "haptic", pattern: "e1", durationMs: VOICE_HAPTIC_MS });
          }
          emit({ type: "audio", data: Buffer.from(chunk).toString("base64") });
        }
      } catch (error) {
        if (input.signal?.aborted) return;
        ttsFailed = true;
        emit(voiceErrorEvent("tts", error));
      }
    });
  };

  const segmenter = new SentenceSegmenter();
  const chatStartedAt = Date.now();
  let firstTokenAt: number | null = null;
  let result: UnifiedModelResult | null = null;
  let chatError: unknown = null;
  let draftText = "";
  let assistantMessage: ConversationMessage | null = null;
  let lastPublished = "";
  let publishChain: Promise<void> = Promise.resolve();
  let publishTimer: NodeJS.Timeout | null = null;

  const upsertAssistant = async (text: string): Promise<void> => {
    const content = sanitizeForSpeech(text).text.trim();
    if (!content || content === lastPublished) return;
    lastPublished = content;
    if (!assistantMessage) {
      assistantMessage = {
        id: `msg-${randomUUID()}`,
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
        runId,
        modelSlotId: slot.id,
        provider: slot.provider,
        modelId: slot.modelId,
        comparisonGroupId,
      };
    } else {
      assistantMessage = { ...assistantMessage, content };
    }
    if (input.clientPersist) return;
    const saved = assistantMessage;
    await conversationRepository.mutate(profileId, conversationId, (current) => ({
      ...current,
      messages: current.messages.some((message) => message.id === saved.id)
        ? current.messages.map((message) => (message.id === saved.id ? saved : message))
        : [...current.messages, saved],
    }));
  };

  const publishDraft = (force = false): void => {
    const run = (): void => {
      publishTimer = null;
      const snapshot = draftText;
      publishChain = publishChain.then(() => upsertAssistant(snapshot)).catch(() => undefined);
    };
    if (force) {
      if (publishTimer) clearTimeout(publishTimer);
      run();
      return;
    }
    publishTimer ??= setTimeout(run, 300);
  };

  if (sharedTurn.urgentReply) {
    result = {
      provider: slot.provider,
      modelId: slot.modelId,
      responseId: null,
      text: sharedTurn.urgentReply,
      usage: UNAVAILABLE_USAGE,
      latencyMs: 0,
      appliedParameters: [],
      finishReason: "completed",
    };
    for (const segment of [...segmenter.push(result.text), ...segmenter.flush()]) {
      speak(segment);
    }
  } else {
    try {
      const providerSettings = settings.providers[slot.provider];
      const stream = getAdapter(slot.provider).stream(
        {
          provider: slot.provider,
          modelId: slot.modelId,
          instructions: contextSnapshot.renderedInstructions,
          input: contextSnapshot.renderedInput,
          generation,
          timeoutMs: providerSettings.transport.timeoutMs,
          maxRetries: providerSettings.transport.maxRetries,
          metadata: {
            runId,
            conversationId,
            sharedContextHash: contextSnapshot.sharedHash,
            contextHash: contextSnapshot.hash,
          },
        },
        input.signal,
      );
      for await (const event of stream) {
        if (event.type === "delta") {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
            mark("first_token");
          }
          draftText += event.text;
          publishDraft();
          for (const segment of segmenter.push(event.text)) speak(segment);
        } else {
          result = event.result;
        }
      }
      for (const segment of segmenter.flush()) speak(segment);
    } catch (error) {
      chatError = error;
    }
  }

  if (result?.text) draftText = result.text;
  publishDraft(true);
  await publishChain;

  await ttsChain;
  if (input.signal?.aborted) return;

  if (chatError) emit(voiceErrorEvent("chat", chatError));
  emit({ type: "speech_end" });

  const completedAt = new Date().toISOString();
  const settingsSnapshot = buildSettingsSnapshot({
    settings,
    slot,
    generation,
    persona,
    promptPreset,
    createdAt: startedAt,
  });
  const baseRun = {
    id: runId,
    profileId,
    modelSlotId: slot.id,
    slotLabel: slot.label,
    comparisonGroupId,
    comparisonRunIds: [],
    conversationId,
    userMessageId,
    mode: "single" as const,
    provider: slot.provider,
    modelId: slot.modelId,
    startedAt,
    completedAt,
    settingsSnapshot,
    contextSnapshot,
    sharedContextHash: contextSnapshot.sharedHash,
    contextHash: contextSnapshot.hash,
    behaviorTrace,
  };

  // 在回调里赋值，TS 会把外面这个变量收窄成 null。
  const finalAssistant = assistantMessage as ConversationMessage | null;
  let run: RunRecord;
  if (result && !chatError && finalAssistant) {
    run = {
      ...baseRun,
      assistantMessageId: finalAssistant.id,
      status: "succeeded",
      latencyMs: result.latencyMs,
      timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - chatStartedAt,
      appliedParameters: result.appliedParameters,
      outputText: result.text,
      usage: result.usage,
      providerResponseId: result.responseId,
      finishReason: result.finishReason,
      policyDeviation: measureTurnPlanDeviation(result.text, sharedTurn.turnPlan),
      error: null,
    };
  } else {
    const appError =
      chatError instanceof AppError
        ? chatError
        : new AppError("UNKNOWN_ERROR", "调用失败");
    run = {
      ...baseRun,
      assistantMessageId: null,
      status: "failed",
      latencyMs: null,
      timeToFirstTokenMs: null,
      appliedParameters: [],
      outputText: null,
      usage: UNAVAILABLE_USAGE,
      providerResponseId: null,
      finishReason: null,
      policyDeviation: null,
      error: {
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
      },
    };
  }

  if (!input.clientPersist) {
    // 赋值发生在流式回调里，TS 的控制流分析看不到，会把它收窄成 null。
    const reply = assistantMessage as ConversationMessage | null;
    await conversationRepository.mutate(profileId, conversationId, (current) => ({
      ...current,
      messages:
        reply && !current.messages.some((message) => message.id === reply.id)
          ? [...current.messages, reply]
          : current.messages,
      worldviewScheduleState: sharedTurn.worldviewScheduleStateCommit,
    }));
    await runRepository.appendMany([run], settings.logging.maxRuns);
    if (assistantMessage) {
      await memoryRepository.markUsed(profileId, contextSnapshot.selectedMemoryIds);
    }
  }

  const memoryExtraction = await runMemoryExtraction({
    profileId,
    conversationId,
    userMessageId,
    userMessage: transcript,
    priorMessages: conversation.messages,
    settings,
    clientPersist: input.clientPersist,
    forceAutoMemoryWrite: input.forceAutoMemoryWrite,
  });

  await appendUsageLog({
    userId: actor.userId,
    role: actor.role,
    event: "voice_chat",
    provider: slot.provider,
    modelId: slot.modelId,
    ok: run.status === "succeeded",
    latencyMs: run.latencyMs,
    promptTokens: run.usage.inputTokens,
    completionTokens: run.usage.outputTokens,
  });
  if (ttsStartedAt !== null) {
    await appendUsageLog({
      userId: actor.userId,
      role: actor.role,
      event: "voice_tts",
      provider: "minimax",
      modelId: getMinimaxTtsModel(),
      ok: !ttsFailed,
      latencyMs: firstAudioAt === null ? null : firstAudioAt - ttsStartedAt,
    });
  }

  emit({
    type: "done",
    userMessage,
    assistantMessage,
    memoryExtraction: {
      status: memoryExtraction.status,
      candidateIds: memoryExtraction.candidateIds,
      ...(memoryExtraction.candidates ? { candidates: memoryExtraction.candidates } : {}),
    },
    configHash: sharedTurn.behaviorTrace.behaviorConfigHash,
    metrics: {
      asrLatencyMs,
      firstTokenLatencyMs: firstTokenAt === null ? null : firstTokenAt - chatStartedAt,
      firstAudioLatencyMs: firstAudioAt === null ? null : firstAudioAt - asrStartedAt,
    },
  });
}
