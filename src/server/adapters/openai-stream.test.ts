import { afterEach, describe, expect, it, vi } from "vitest";
import { deepSeekAdapter } from "./deepseek";
import type { UnifiedModelRequest } from "./types";

const request: UnifiedModelRequest = {
  provider: "deepseek",
  modelId: "deepseek-chat",
  instructions: "sys",
  input: "hi",
  generation: {
    temperature: 0.7,
    topP: null,
    presencePenalty: null,
    frequencyPenalty: null,
    seed: null,
    maxOutputTokens: 256,
    thinkingMode: null,
    reasoningEffort: null,
    verbosity: null,
  },
  timeoutMs: 5_000,
  maxRetries: 0,
  metadata: { runId: "r", conversationId: "c", sharedContextHash: "s", contextHash: "h" },
};

function sse(lines: string[]): Response {
  return new Response(lines.map((line) => `data: ${line}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI 兼容流式生成", () => {
  it("只产出正文增量，忽略推理内容，并汇总用量", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sse([
        JSON.stringify({ id: "r1", choices: [{ delta: { reasoning_content: "想想" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "你好" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "呀。" }, finish_reason: "stop" }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
        "[DONE]",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    let text = "";
    for await (const event of deepSeekAdapter.stream(request)) {
      if (event.type === "delta") deltas.push(event.text);
      else {
        text = event.result.text;
        expect(event.result.responseId).toBe("r1");
        expect(event.result.finishReason).toBe("completed");
        expect(event.result.usage.totalTokens).toBe(5);
      }
    }
    expect(deltas).toEqual(["你好", "呀。"]);
    expect(text).toBe("你好呀。");
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
  });

  it("空正文按失败处理", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(["[DONE]"])));
    const drain = async () => {
      for await (const _event of deepSeekAdapter.stream(request)) {
        // 消费流
      }
    };
    await expect(drain()).rejects.toMatchObject({ code: "EMPTY_MODEL_OUTPUT" });
  });
});
