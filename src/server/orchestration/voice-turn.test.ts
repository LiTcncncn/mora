import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceTurnEvent } from "@/domain/voice";
import { AppError } from "../api/errors";
import { getDataDir } from "../config/env";
import { ensureBootstrapped } from "../persistence/bootstrap";
import {
  conversationRepository,
  runRepository,
  settingsRepository,
} from "../persistence/repositories";
import type { ModelAdapter, UnifiedModelResult } from "../adapters/types";
import { runVoiceTurn } from "./voice-turn";

const DEFAULT_PROFILE = "profile-default";
const VOICE = "Chinese (Mandarin)_Warm_Girl" as const;

const streams = new Map<string, () => AsyncGenerator<string>>();
const asr = { text: "今天好累" as string, error: null as AppError | null };
const spoken: string[] = [];

vi.mock("../adapters/registry", () => ({
  getAdapter: (provider: string): ModelAdapter =>
    ({
      id: provider,
      getCapabilities: () => ({}),
      complete: async () => {
        throw new AppError("PROVIDER_UNAVAILABLE", "未配置 mock");
      },
      stream: async function* () {
        const source = streams.get(provider);
        if (!source) throw new AppError("PROVIDER_UNAVAILABLE", "未配置 mock");
        let text = "";
        for await (const delta of source()) {
          text += delta;
          yield { type: "delta" as const, text: delta };
        }
        const result: UnifiedModelResult = {
          provider: provider as UnifiedModelResult["provider"],
          modelId: `${provider}-model`,
          responseId: "resp",
          text,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, source: "provider" },
          latencyMs: 12,
          appliedParameters: [],
          finishReason: "completed",
        };
        yield { type: "done" as const, result };
      },
      testConnection: async () => ({ ok: true, message: "ok", latencyMs: 1 }),
    }) as unknown as ModelAdapter,
  listAdapters: () => [],
}));

vi.mock("../speech/minimax", () => ({
  transcribeWav: async () => {
    if (asr.error) throw asr.error;
    return { text: asr.text, durationSec: 1, traceId: "t" };
  },
  synthesizeSpeech: async function* ({ text }: { text: string }) {
    spoken.push(text);
    yield new Uint8Array([0, 1]);
  },
}));

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function setup(): Promise<{ conversationId: string; kimiSlotId: string }> {
  const settings = await settingsRepository.get(DEFAULT_PROFILE);
  settings.memory.autoCandidateExtraction.enabled = false;
  await settingsRepository.save(DEFAULT_PROFILE, settings);
  const kimiSlot = settings.compare.modelSlots.find(
    (slot) => slot.provider === "kimi" && slot.enabled,
  );
  if (!kimiSlot) throw new Error("fixture 缺少启用的 Kimi 槽位");
  const conversation = await conversationRepository.create(DEFAULT_PROFILE, "语音");
  return { conversationId: conversation.id, kimiSlotId: kimiSlot.id };
}

async function run(conversationId: string, modelSlotId: string): Promise<VoiceTurnEvent[]> {
  const events: VoiceTurnEvent[] = [];
  await runVoiceTurn(
    {
      profileId: DEFAULT_PROFILE,
      conversationId,
      modelSlotId,
      voiceId: VOICE,
      audio: new Blob([new Uint8Array(44)]),
      clientPersist: false,
      forceAutoMemoryWrite: false,
      actor: { userId: "user-admin-1", role: "admin" },
    },
    (event) => events.push(event),
  );
  return events;
}

beforeEach(async () => {
  await fs.rm(getDataDir(), { recursive: true, force: true });
  await fs.mkdir(getDataDir(), { recursive: true });
  await ensureBootstrapped().catch(() => undefined);
  streams.clear();
  spoken.length = 0;
  asr.text = "今天好累";
  asr.error = null;
  streams.set("deepseek", () =>
    chunks(JSON.stringify({ energy: { level: "E1", confidence: 0.8, evidence: [] } })),
  );
});

describe("runVoiceTurn", () => {
  it("识别文本进入陪伴管线，逐句合成语音并写入对话与 Run", async () => {
    const { conversationId, kimiSlotId } = await setup();
    streams.set("kimi", () => chunks("（轻轻靠近）今天", "辛苦了。", "先歇一会儿吧。"));

    const events = await run(conversationId, kimiSlotId);
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("timing");
    expect(types).toContain("transcript");
    expect(types).toContain("audio");
    expect(types).toContain("speech_end");
    expect(types.at(-1)).toBe("done");
    expect(spoken).toEqual(["今天辛苦了。", "先歇一会儿吧。"]);

    const done = events.at(-1) as Extract<VoiceTurnEvent, { type: "done" }>;
    expect(done.userMessage.content).toBe("今天好累");
    expect(done.assistantMessage?.content).toBe("今天辛苦了。先歇一会儿吧。");

    const conversation = await conversationRepository.get(DEFAULT_PROFILE, conversationId);
    expect(conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    const runs = await runRepository.list(DEFAULT_PROFILE);
    const saved = runs.find(
      (item) => item.conversationId === conversationId && item.modelSlotId === kimiSlotId,
    );
    expect(saved?.status).toBe("succeeded");
    expect(saved?.mode).toBe("single");
  });

  it("只调用所选模型", async () => {
    const { conversationId, kimiSlotId } = await setup();
    const kimi = vi.fn(() => chunks("嗯。"));
    streams.set("kimi", kimi);
    await run(conversationId, kimiSlotId);
    expect(kimi).toHaveBeenCalledTimes(1);
    const conversation = await conversationRepository.get(DEFAULT_PROFILE, conversationId);
    expect(conversation.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("没有识别出内容时只返回 empty，不写对话", async () => {
    const { conversationId, kimiSlotId } = await setup();
    asr.text = "。";
    const events = await run(conversationId, kimiSlotId);
    expect(events.some((event) => event.type === "empty")).toBe(true);
    expect(events.some((event) => event.type === "transcript")).toBe(false);
    const conversation = await conversationRepository.get(DEFAULT_PROFILE, conversationId);
    expect(conversation.messages).toHaveLength(0);
  });

  it("ASR 失败时返回 asr 错误事件", async () => {
    const { conversationId, kimiSlotId } = await setup();
    asr.error = new AppError("PROVIDER_AUTH_ERROR", "MiniMax ASR 调用失败：auth");
    const events = await run(conversationId, kimiSlotId);
    expect(events).toEqual([
      expect.objectContaining({ type: "error", stage: "asr", code: "PROVIDER_AUTH_ERROR" }),
    ]);
  });

  it("模型失败时不产生保底回复，Run 记为失败", async () => {
    const { conversationId, kimiSlotId } = await setup();
    streams.set("kimi", async function* () {
      yield* [];
      throw new AppError("PROVIDER_TIMEOUT", "Kimi 调用超时");
    });
    const events = await run(conversationId, kimiSlotId);
    expect(events.some((event) => event.type === "error" && event.stage === "chat")).toBe(true);
    const done = events.at(-1) as Extract<VoiceTurnEvent, { type: "done" }>;
    expect(done.assistantMessage).toBeNull();
    expect(spoken).toEqual([]);
  });
});
