import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_FAILED_TEXT } from "@/domain/common";
import { AppError } from "../api/errors";
import { getDataDir } from "../config/env";
import { ensureBootstrapped } from "../persistence/bootstrap";
import {
  conversationRepository,
  memoryRepository,
  runRepository,
  settingsRepository,
} from "../persistence/repositories";
import type { ModelAdapter, UnifiedModelResult } from "../adapters/types";
import { runCompare } from "./compare";

const DEFAULT_PROFILE = "profile-default";

const completions = new Map<string, () => Promise<UnifiedModelResult>>();

vi.mock("../adapters/registry", () => ({
  getAdapter: (provider: string): ModelAdapter =>
    ({
      id: provider,
      getCapabilities: () => ({
        supportsTemperature: true,
        supportsTopP: true,
        supportsPresencePenalty: true,
        supportsFrequencyPenalty: true,
        supportsSeed: false,
        supportsThinkingMode: true,
        supportsReasoningEffort: true,
        supportsVerbosity: true,
        supportsStreaming: false,
        reportsUsage: true,
      }),
      complete: async () => {
        const handler = completions.get(provider);
        if (!handler) throw new AppError("PROVIDER_UNAVAILABLE", "未配置 mock");
        return handler();
      },
      testConnection: async () => ({ ok: true, message: "ok", latencyMs: 1 }),
    }) as ModelAdapter,
  listAdapters: () => [],
}));

function succeed(provider: string, text: string): UnifiedModelResult {
  return {
    provider: provider as UnifiedModelResult["provider"],
    modelId: `${provider}-model`,
    responseId: `resp-${provider}`,
    text,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      source: "provider",
    },
    latencyMs: 42,
    appliedParameters: [],
    finishReason: "completed",
  };
}

async function newConversation(): Promise<string> {
  const conversation = await conversationRepository.create(
    DEFAULT_PROFILE,
    "测试对话",
  );
  return conversation.id;
}

beforeEach(async () => {
  await fs.rm(getDataDir(), { recursive: true, force: true });
  await fs.mkdir(getDataDir(), { recursive: true });
  await ensureBootstrapped().catch(() => undefined);

  completions.clear();
  completions.set("kimi", async () => succeed("kimi", "Kimi 的完整回复"));
  completions.set("deepseek", async () =>
    succeed("deepseek", "DeepSeek 的完整回复"),
  );

  // 默认关闭自动记忆提取，避免与模型调用断言互相干扰。
  const settings = await settingsRepository.get(DEFAULT_PROFILE);
  settings.memory.autoCandidateExtraction.enabled = false;
  await settingsRepository.save(DEFAULT_PROFILE, settings);
});

describe("runCompare", () => {
  it("为每个启用槽位返回独立结果，共享同一个 sharedContextHash", async () => {
    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    expect(result.candidates).toHaveLength(2);
    expect(new Set(result.candidates.map((c) => c.laneContextHash)).size).toBe(1);
    expect(result.candidates.every((c) => c.status === "succeeded")).toBe(true);
    expect(result.candidates.map((c) => c.text)).toEqual([
      "Kimi 的完整回复",
      "DeepSeek 的完整回复",
    ]);
  });

  it("displayText 等于完整原文，不做任何截断", async () => {
    const long = "很长的陪伴回复。".repeat(400);
    completions.set("kimi", async () => succeed("kimi", long));

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    const kimi = result.candidates.find((c) => c.provider === "kimi")!;
    expect(kimi.displayText).toBe(long);
    expect(kimi.text).toBe(long);
  });

  it("单个槽位失败不影响其他槽位，且不产生任何保底文本", async () => {
    completions.set("deepseek", async () => {
      throw new AppError("PROVIDER_TIMEOUT", "DeepSeek 调用超时");
    });

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    const failed = result.candidates.find((c) => c.provider === "deepseek")!;
    const ok = result.candidates.find((c) => c.provider === "kimi")!;

    expect(failed.status).toBe("failed");
    expect(failed.text).toBeNull();
    expect(failed.displayText).toBe(CALL_FAILED_TEXT);
    expect(failed.assistantMessageId).toBeNull();
    expect(ok.status).toBe("succeeded");
    expect(ok.text).toBe("Kimi 的完整回复");
  });

  it("失败槽位保存 failed run，但不写入 assistant 消息", async () => {
    completions.set("deepseek", async () => {
      throw new AppError("PROVIDER_AUTH_ERROR", "认证失败");
    });

    const conversationId = await newConversation();
    await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    const conversation = await conversationRepository.get(
      DEFAULT_PROFILE,
      conversationId,
    );
    const runs = await runRepository.list(DEFAULT_PROFILE);

    expect(runs).toHaveLength(2);
    expect(runs.filter((run) => run.status === "failed")).toHaveLength(1);
    expect(
      conversation.messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
      conversation.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("全部槽位失败时仍保留用户消息，且没有任何 assistant 消息", async () => {
    completions.set("kimi", async () => {
      throw new AppError("PROVIDER_UNAVAILABLE", "不可用");
    });
    completions.set("deepseek", async () => {
      throw new AppError("PROVIDER_UNAVAILABLE", "不可用");
    });

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    const conversation = await conversationRepository.get(
      DEFAULT_PROFILE,
      conversationId,
    );

    expect(result.candidates.every((c) => c.displayText === CALL_FAILED_TEXT)).toBe(
      true,
    );
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.role).toBe("user");
  });

  it("第二轮各槽位使用自己的历史，laneContextHash 分叉但 sharedContextHash 仍一致", async () => {
    const conversationId = await newConversation();
    await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "第一句",
    });

    const second = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "第二句",
    });

    const hashes = new Set(second.candidates.map((c) => c.laneContextHash));
    expect(hashes.size).toBe(2);

    const runs = await runRepository.list(DEFAULT_PROFILE);
    const secondRoundRuns = runs.filter(
      (run) => run.comparisonGroupId === second.comparisonGroupId,
    );
    expect(new Set(secondRoundRuns.map((run) => run.sharedContextHash)).size).toBe(
      1,
    );

    const kimiRun = secondRoundRuns.find((run) => run.provider === "kimi")!;
    expect(kimiRun.contextSnapshot.renderedInput).toContain("Kimi 的完整回复");
    expect(kimiRun.contextSnapshot.renderedInput).not.toContain(
      "DeepSeek 的完整回复",
    );
  });

  it("只启用一个槽位时自然形成单模型测试", async () => {
    const settings = await settingsRepository.get(DEFAULT_PROFILE);
    settings.compare.modelSlots = settings.compare.modelSlots.map((slot) => ({
      ...slot,
      enabled: slot.provider === "kimi",
    }));
    await settingsRepository.save(DEFAULT_PROFILE, settings);

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.provider).toBe("kimi");
  });

  it("没有启用槽位时返回校验错误", async () => {
    const settings = await settingsRepository.get(DEFAULT_PROFILE);
    settings.compare.modelSlots = settings.compare.modelSlots.map((slot) => ({
      ...slot,
      enabled: false,
    }));
    await settingsRepository.save(DEFAULT_PROFILE, settings);

    const conversationId = await newConversation();
    await expect(
      runCompare({
        profileId: DEFAULT_PROFILE,
        conversationId,
        userMessage: "今天好累",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("记忆提取失败只显示调用失败，不影响模型结果", async () => {
    const settings = await settingsRepository.get(DEFAULT_PROFILE);
    settings.memory.autoCandidateExtraction.enabled = true;
    settings.memory.autoCandidateExtraction.provider = "deepseek";
    settings.energy.mode = "rule_based";
    await settingsRepository.save(DEFAULT_PROFILE, settings);

    let call = 0;
    completions.set("deepseek", async () => {
      call += 1;
      // 第一次是聊天调用，第二次是记忆提取调用。
      if (call === 1) return succeed("deepseek", "DeepSeek 的完整回复");
      throw new AppError("PROVIDER_TIMEOUT", "提取超时");
    });

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "今天好累",
    });

    expect(result.memoryExtraction.status).toBe("failed");
    expect(result.memoryExtraction.displayText).toBe(CALL_FAILED_TEXT);
    expect(result.candidates.every((c) => c.status === "succeeded")).toBe(true);
    expect(await memoryRepository.list(DEFAULT_PROFILE)).toHaveLength(0);
  });

  it("提取出的记忆默认自动写入 active", async () => {
    const settings = await settingsRepository.get(DEFAULT_PROFILE);
    settings.memory.autoCandidateExtraction.enabled = true;
    settings.memory.autoCandidateExtraction.provider = "deepseek";
    settings.energy.mode = "rule_based";
    await settingsRepository.save(DEFAULT_PROFILE, settings);

    let call = 0;
    completions.set("deepseek", async () => {
      call += 1;
      if (call === 1) return succeed("deepseek", "DeepSeek 的完整回复");
      return succeed(
        "deepseek",
        '{"candidates":[{"type":"event","content":"你最近在做项目交接","importance":0.7}]}',
      );
    });

    const conversationId = await newConversation();
    const result = await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "最近在做项目交接",
    });

    const memories = await memoryRepository.list(DEFAULT_PROFILE);
    expect(result.memoryExtraction.status).toBe("succeeded");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.status).toBe("active");
    expect(memories[0]?.source.kind).toBe("conversation_candidate");
  });

  it("开启人工确认时提取结果保持 candidate", async () => {
    const settings = await settingsRepository.get(DEFAULT_PROFILE);
    settings.memory.autoCandidateExtraction.enabled = true;
    settings.memory.autoCandidateExtraction.provider = "deepseek";
    settings.memory.autoCandidateExtraction.requireManualApproval = true;
    settings.energy.mode = "rule_based";
    await settingsRepository.save(DEFAULT_PROFILE, settings);

    let call = 0;
    completions.set("deepseek", async () => {
      call += 1;
      if (call === 1) return succeed("deepseek", "DeepSeek 的完整回复");
      return succeed(
        "deepseek",
        '{"candidates":[{"type":"event","content":"你最近在做项目交接","importance":0.7}]}',
      );
    });

    const conversationId = await newConversation();
    await runCompare({
      profileId: DEFAULT_PROFILE,
      conversationId,
      userMessage: "最近在做项目交接",
    });

    const memories = await memoryRepository.list(DEFAULT_PROFILE);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.status).toBe("candidate");
  });

  it("空消息被拒绝", async () => {
    const conversationId = await newConversation();
    await expect(
      runCompare({
        profileId: DEFAULT_PROFILE,
        conversationId,
        userMessage: "   ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
