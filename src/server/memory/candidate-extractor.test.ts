import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/domain/conversation";
import {
  isGroundedMemoryContent,
  priorContextBeforeUserMessage,
  userTextsFromIds,
} from "./candidate-extractor";

function msg(
  overrides: Partial<ConversationMessage> &
    Pick<ConversationMessage, "id" | "role" | "content">,
): ConversationMessage {
  return {
    createdAt: "2026-08-23T00:00:00.000Z",
    runId: null,
    modelSlotId: overrides.role === "assistant" ? "slot-kimi" : null,
    provider: overrides.role === "assistant" ? "kimi" : null,
    modelId: overrides.role === "assistant" ? "kimi-k2.6" : null,
    comparisonGroupId: "cmp-1",
    ...overrides,
  };
}

describe("isGroundedMemoryContent", () => {
  it("丢掉未展开的指代", () => {
    expect(isGroundedMemoryContent("你很喜欢对方所说的片段")).toBe(false);
    expect(isGroundedMemoryContent("你喜欢你说的那些")).toBe(false);
    expect(isGroundedMemoryContent("你很喜欢这些片段")).toBe(false);
  });

  it("指代已落到具体名称时保留", () => {
    expect(
      isGroundedMemoryContent(
        "你表示喜欢对话中提到的《海蒂》里赤脚跑向爷爷的片段",
      ),
    ).toBe(true);
  });

  it("本身具体的事实保留", () => {
    expect(isGroundedMemoryContent("你最近在做项目交接")).toBe(true);
  });
});

describe("priorContextBeforeUserMessage", () => {
  it("只用焦点用户句之前的消息，不含本轮之后的陪伴回复", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "有喜欢的电影片段吗" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "海蒂赤脚跑向爷爷。",
        modelId: "kimi-k2.6",
      }),
      msg({ id: "u2", role: "user", content: "我也很喜欢你说的片段" }),
      msg({
        id: "a2",
        role: "assistant",
        content: "本轮新回复不该被当成所指",
        modelId: "kimi-k2.6",
      }),
    ];

    const prior = priorContextBeforeUserMessage(messages, "u2");
    expect(prior.map((line) => line.content)).toEqual([
      "有喜欢的电影片段吗",
      "海蒂赤脚跑向爷爷。",
    ]);
    expect(prior.some((line) => line.content.includes("本轮新回复"))).toBe(
      false,
    );
  });
});

describe("userTextsFromIds", () => {
  it("只收集指定的用户原话", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "第一句" }),
      msg({ id: "a1", role: "assistant", content: "回复" }),
      msg({ id: "u2", role: "user", content: "第二句" }),
    ];
    expect(userTextsFromIds(messages, ["u2", "a1"])).toEqual([
      { messageId: "u2", content: "第二句" },
    ]);
  });
});
