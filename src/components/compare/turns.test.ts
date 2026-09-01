import { describe, expect, it } from "vitest";
import type { RunSummary } from "@/domain/run";
import type { ModelSlot } from "@/domain/settings";
import { buildTurns } from "./turns";
import { makeConversation, makeMessage } from "@/test/fixtures";

const slots: ModelSlot[] = [
  {
    id: "slot-a",
    label: "A",
    enabled: true,
    provider: "kimi",
    modelId: "m1",
    generationOverrides: {},
  },
  {
    id: "slot-b",
    label: "B",
    enabled: true,
    provider: "deepseek",
    modelId: "m2",
    generationOverrides: {},
  },
];

function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: "run-1",
    profileId: "profile-default",
    modelSlotId: "slot-a",
    slotLabel: "A",
    comparisonGroupId: "cmp-1",
    conversationId: "conv-1",
    mode: "compare",
    status: "succeeded",
    provider: "kimi",
    modelId: "m1",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    latencyMs: 10,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      source: "unavailable",
    },
    finishReason: "completed",
    contextHash: "lane-a",
    sharedContextHash: "shared-1",
    error: null,
    ...overrides,
  };
}

describe("buildTurns", () => {
  it("失败槽位没有 assistant 消息，但仍作为一列出现", () => {
    const conversation = makeConversation([
      makeMessage({
        id: "u1",
        role: "user",
        content: "今天好累",
        comparisonGroupId: "cmp-1",
      }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "A 的回复",
        modelSlotId: "slot-a",
        comparisonGroupId: "cmp-1",
      }),
    ]);

    const turns = buildTurns(
      conversation,
      [
        run({}),
        run({
          id: "run-2",
          modelSlotId: "slot-b",
          slotLabel: "B",
          provider: "deepseek",
          status: "failed",
          contextHash: "lane-a",
          error: { code: "PROVIDER_TIMEOUT", message: "超时", retryable: true },
        }),
      ],
      slots,
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.lanes).toHaveLength(2);
    expect(turns[0]?.lanes[1]?.message).toBeNull();
    expect(turns[0]?.lanes[1]?.run?.status).toBe("failed");
    expect(turns[0]?.lanesShareContext).toBe(true);
  });

  it("各槽位 contextHash 不同时标记为已分叉", () => {
    const conversation = makeConversation([
      makeMessage({
        id: "u1",
        role: "user",
        content: "第二句",
        comparisonGroupId: "cmp-1",
      }),
    ]);

    const turns = buildTurns(
      conversation,
      [
        run({}),
        run({ id: "run-2", modelSlotId: "slot-b", contextHash: "lane-b" }),
      ],
      slots,
    );

    expect(turns[0]?.lanesShareContext).toBe(false);
    expect(turns[0]?.sharedContextHash).toBe("shared-1");
  });

  it("绝不把某个槽位的回复填给另一个槽位", () => {
    const conversation = makeConversation([
      makeMessage({
        id: "u1",
        role: "user",
        content: "你好",
        comparisonGroupId: "cmp-1",
      }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "只属于 A",
        modelSlotId: "slot-a",
        comparisonGroupId: "cmp-1",
      }),
    ]);

    const turns = buildTurns(conversation, [run({}), run({ id: "r2", modelSlotId: "slot-b" })], slots);
    const laneB = turns[0]?.lanes.find((lane) => lane.slot.id === "slot-b");

    expect(laneB?.message).toBeNull();
  });
});
