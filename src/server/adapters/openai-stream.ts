import "server-only";
import type { FinishReason, ProviderId, TokenUsage } from "@/domain/common";
import type { AppliedParameter } from "@/domain/run";
import { AppError } from "../api/errors";
import { mapProviderError, ProviderTimeoutError, withRetries } from "./provider-error";
import { createProviderAgent } from "./timed-fetch";
import { UNAVAILABLE_USAGE, type ModelStreamEvent } from "./types";

interface StreamChunk {
  id?: string;
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
    usage?: RawUsage;
  }>;
  usage?: RawUsage | null;
  error?: { message?: string };
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

function toUsage(raw: RawUsage | null | undefined): TokenUsage {
  if (!raw) return UNAVAILABLE_USAGE;
  return {
    inputTokens: raw.prompt_tokens ?? null,
    outputTokens: raw.completion_tokens ?? null,
    totalTokens: raw.total_tokens ?? null,
    cachedInputTokens: raw.cached_tokens ?? raw.prompt_cache_hit_tokens ?? null,
    reasoningTokens: raw.completion_tokens_details?.reasoning_tokens ?? null,
    source: "provider",
  };
}

/** OpenAI 兼容 Chat Completions 的 SSE 流；只在建立连接前重试。 */
export async function* streamChatCompletions(input: {
  provider: ProviderId;
  label: string;
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
  appliedParameters: AppliedParameter[];
  mapFinishReason: (reason: string | null | undefined) => FinishReason;
  signal?: AbortSignal;
}): AsyncGenerator<ModelStreamEvent> {
  const dispatcher = createProviderAgent(input.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const signal = input.signal
    ? AbortSignal.any([controller.signal, input.signal])
    : controller.signal;
  const startedAt = Date.now();

  const connect = async (): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          ...input.body,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
        dispatcher,
      } as RequestInit);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderTimeoutError(input.label, input.timeoutMs);
      }
      throw mapProviderError(
        input.label,
        null,
        error instanceof Error ? error.message : "未知错误",
      );
    }
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      let message = `HTTP ${response.status}`;
      try {
        message = (JSON.parse(raw) as StreamChunk).error?.message ?? message;
      } catch {
        // 保持 HTTP 状态文案
      }
      throw mapProviderError(input.label, response.status, message);
    }
    return response;
  };

  try {
    const response = await withRetries(input.maxRetries, connect);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    let text = "";
    let responseId: string | null = null;
    let finishReason: string | null = null;
    let usage: TokenUsage = UNAVAILABLE_USAGE;

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const chunk = JSON.parse(payload) as StreamChunk;
          if (chunk.error) {
            throw mapProviderError(input.label, null, chunk.error.message ?? "流式返回错误");
          }
          responseId ??= chunk.id ?? null;
          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content;
          if (delta) {
            text += delta;
            yield { type: "delta", text: delta };
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const rawUsage = chunk.usage ?? choice?.usage;
          if (rawUsage) usage = toUsage(rawUsage);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!text.trim()) {
      throw new AppError("EMPTY_MODEL_OUTPUT", `${input.label} 返回了空内容`);
    }

    yield {
      type: "done",
      result: {
        provider: input.provider,
        modelId: input.modelId,
        responseId,
        text,
        usage,
        latencyMs: Date.now() - startedAt,
        appliedParameters: input.appliedParameters,
        finishReason: input.mapFinishReason(finishReason),
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(input.label, input.timeoutMs);
    }
    throw mapProviderError(
      input.label,
      null,
      error instanceof Error ? error.message : "未知错误",
    );
  } finally {
    clearTimeout(timer);
    await dispatcher.close().catch(() => undefined);
  }
}
