import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../api/errors";
import { deepSeekAdapter } from "./deepseek";
import type { UnifiedModelRequest } from "./types";

function request(
  overrides: Partial<UnifiedModelRequest> = {},
): UnifiedModelRequest {
  return {
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    instructions: "系统指令",
    input: "用户输入",
    generation: {
      temperature: 1,
      topP: null,
      maxOutputTokens: 2000,
      presencePenalty: null,
      frequencyPenalty: null,
      seed: 42,
      thinkingMode: "disabled",
      reasoningEffort: null,
      verbosity: "low",
    },
    timeoutMs: 5000,
    maxRetries: 0,
    metadata: {
      runId: "run-1",
      conversationId: "conv-1",
      sharedContextHash: "shared",
      contextHash: "lane",
    },
    ...overrides,
  };
}

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deepSeekAdapter", () => {
  it("完整返回供应商文本，不做任何截断", async () => {
    const longText = "很长的回复。".repeat(500);
    mockFetch({
      id: "resp-1",
      choices: [{ message: { content: longText }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const result = await deepSeekAdapter.complete(request());

    expect(result.text).toBe(longText);
    expect(result.text.length).toBe(longText.length);
    expect(result.finishReason).toBe("completed");
    expect(result.usage.source).toBe("provider");
  });

  it("按 capability 过滤不支持的参数并记录 not_applied", async () => {
    mockFetch({
      choices: [{ message: { content: "好" }, finish_reason: "stop" }],
    });

    const result = await deepSeekAdapter.complete(request());
    const seedParameter = result.appliedParameters.find(
      (parameter) => parameter.name === "seed",
    );
    const verbosityParameter = result.appliedParameters.find(
      (parameter) => parameter.name === "verbosity",
    );

    expect(seedParameter?.status).toBe("not_applied");
    expect(verbosityParameter?.status).toBe("not_applied");

    const sentBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("seed");
    expect(sentBody).not.toHaveProperty("verbosity");
    expect(sentBody).toHaveProperty("temperature", 1);
  });

  it("输出长度截止映射为 finishReason=length，并保留已返回文本", async () => {
    mockFetch({
      choices: [{ message: { content: "被截断的开头" }, finish_reason: "length" }],
    });

    const result = await deepSeekAdapter.complete(request());
    expect(result.finishReason).toBe("length");
    expect(result.text).toBe("被截断的开头");
  });

  it("认证错误映射为不可重试的结构化错误", async () => {
    mockFetch({ error: { message: "Authentication Fails" } }, 401);

    await expect(deepSeekAdapter.complete(request())).rejects.toMatchObject({
      code: "PROVIDER_AUTH_ERROR",
      retryable: false,
    });
  });

  it("空内容视为失败，不返回任何保底文本", async () => {
    mockFetch({ choices: [{ message: { content: "  " }, finish_reason: "stop" }] });

    await expect(deepSeekAdapter.complete(request())).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("限流错误在重试耗尽后仍然失败", async () => {
    mockFetch({ error: { message: "rate limited" } }, 429);

    await expect(
      deepSeekAdapter.complete(request({ maxRetries: 1 })),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("错误信息中不包含 API Key", async () => {
    mockFetch(
      { error: { message: "bad key sk-test-deepseek-key-value" } },
      400,
    );

    await expect(deepSeekAdapter.complete(request())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        !error.message.includes("sk-test-deepseek-key-value"),
    );
  });
});
