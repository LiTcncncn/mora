import { personasDataSchema, type Persona } from "@/domain/persona";
import { promptPresetsDataSchema, type PromptPreset } from "@/domain/prompt";
import {
  settingsStoreDataSchema,
  type SettingsData,
} from "@/domain/settings";
import { storeEnvelopeSchema } from "@/domain/store";
import type { Conversation, ConversationMessage } from "@/domain/conversation";
import type { FewShotSample } from "@/domain/fewshot";
import type { MemoryItem } from "@/domain/memory";
import type { RunRecord } from "@/domain/run";
import { buildContext } from "@/server/context/builder";
import personasSeed from "../../data-seed/personas.json";
import promptPresetsSeed from "../../data-seed/prompt-presets.json";
import settingsSeed from "../../data-seed/settings.json";

export function seedSettings(): SettingsData {
  const parsed = storeEnvelopeSchema(settingsStoreDataSchema).parse(settingsSeed);
  return structuredClone(parsed.data.items[0]!.settings);
}

export function seedPersona(): Persona {
  const parsed = storeEnvelopeSchema(personasDataSchema).parse(personasSeed);
  return structuredClone(parsed.data.items[0]!);
}

export function seedPromptPreset(): PromptPreset {
  const parsed = storeEnvelopeSchema(promptPresetsDataSchema).parse(
    promptPresetsSeed,
  );
  return structuredClone(parsed.data.items[0]!);
}

export function makeMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "mem-1",
    profileId: "profile-default",
    type: "event",
    content: "你最近在做项目交接",
    importance: 0.6,
    enabled: true,
    pinned: false,
    tags: [],
    source: { kind: "manual" },
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastUsedAt: null,
    useCount: 0,
    expiresAt: null,
    ...overrides,
  };
}

export function makeFewShotSample(
  overrides: Partial<FewShotSample> = {},
): FewShotSample {
  return {
    id: "fs-1",
    profileId: "profile-default",
    scene: "疲惫不想动",
    energy: "any",
    worldview: "none",
    keywords: ["累"],
    user: "好累，什么都不想干。",
    reply: "躺着就躺着吧，又不是比赛。",
    note: "",
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeMessage(
  overrides: Partial<ConversationMessage> & Pick<ConversationMessage, "id" | "role">,
): ConversationMessage {
  return {
    content: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    runId: null,
    modelSlotId: overrides.role === "user" ? null : "slot-kimi",
    provider: null,
    modelId: null,
    comparisonGroupId: null,
    ...overrides,
  };
}

export function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const settings = seedSettings();
  const persona = seedPersona();
  const promptPreset = seedPromptPreset();

  const contextSnapshot = buildContext({
    modelSlotId: "slot-kimi",
    userMessage: "今天好累",
    conversation: makeConversation(),
    persona,
    energyResolution: {
      level: "E1",
      source: "rule_based",
      reason: "测试",
      signals: [],
    },
    selectedMemories: [],
    memoryTrace: [],
    promptPreset,
    settings: {
      context: settings.context,
      memory: settings.memory,
      energy: settings.energy,
    },
  });

  return {
    id: "run-x",
    profileId: "profile-default",
    modelSlotId: "slot-kimi",
    slotLabel: "Kimi",
    comparisonGroupId: "cmp-1",
    comparisonRunIds: [],
    conversationId: "conv-1",
    userMessageId: "msg-1",
    assistantMessageId: null,
    mode: "compare",
    status: "failed",
    provider: "kimi",
    modelId: "kimi-k2.6",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    latencyMs: null,
    timeToFirstTokenMs: null,
    settingsSnapshot: {
      id: "snap-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      common: {
        energy: settings.energy,
        memory: settings.memory,
        context: settings.context,
        activePersonaId: persona.id,
        activePromptPresetId: promptPreset.id,
      },
      provider: settings.providers.kimi,
      personaVersion: persona.updatedAt,
      promptPresetVersion: promptPreset.version,
    },
    contextSnapshot,
    sharedContextHash: contextSnapshot.sharedHash,
    contextHash: contextSnapshot.hash,
    appliedParameters: [],
    outputText: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      source: "unavailable",
    },
    estimatedCost: {
      amount: null,
      currency: "USD",
      isEstimate: true,
      pricingLabel: null,
      effectiveDate: null,
    },
    providerResponseId: null,
    finishReason: null,
    policyDeviation: null,
    error: { code: "PROVIDER_TIMEOUT", message: "超时", retryable: true },
    ...overrides,
  };
}

export function makeConversation(
  messages: ConversationMessage[] = [],
): Conversation {
  return {
    id: "conv-1",
    profileId: "profile-default",
    title: "测试对话",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    messages,
  };
}
