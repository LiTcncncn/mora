import "server-only";
import type { FinishReason } from "@/domain/common";
import { AppError } from "../api/errors";
import { getDeepSeekApiKey, getDeepSeekBaseUrl } from "../config/env";
import {
  mapProviderError,
  ProviderTimeoutError,
  withRetries,
} from "./provider-error";
import {
  buildAppliedParameters,
  UNAVAILABLE_USAGE,
  type ModelAdapter,
  type ModelCapabilities,
  type UnifiedModelRequest,
  type UnifiedModelResult,
} from "./types";

interface DeepSeekChoice {
  message?: { content?: string | null };
  finish_reason?: string | null;
}

interface DeepSeekResponse {
  id?: string;
  choices?: DeepSeekChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

function capabilitiesFor(_modelId: string): ModelCapabilities {
  return {
    supportsTemperature: true,
    supportsTopP: true,
    supportsPresencePenalty: true,
    supportsFrequencyPenalty: true,
    supportsSeed: false,
    supportsThinkingMode: true,
    supportsReasoningEffort: true,
    supportsVerbosity: false,
    supportsStreaming: true,
    reportsUsage: true,
  };
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "stop":
      return "completed";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "unknown";
  }
}

function requireApiKey(): string {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "DeepSeek 尚未配置 API Key");
  }
  return apiKey;
}

async function callDeepSeek(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<DeepSeekResponse> {
  const apiKey = requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getDeepSeekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: DeepSeekResponse;
    try {
      parsed = JSON.parse(text) as DeepSeekResponse;
    } catch {
      throw mapProviderError("DeepSeek", response.status, "返回内容不是合法 JSON");
    }

    if (!response.ok) {
      throw mapProviderError(
        "DeepSeek",
        response.status,
        parsed.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return parsed;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError("DeepSeek", timeoutMs);
    }
    if (error instanceof AppError) throw error;
    throw mapProviderError(
      "DeepSeek",
      null,
      error instanceof Error ? error.message : "未知错误",
    );
  } finally {
    clearTimeout(timer);
  }
}

export const deepSeekAdapter: ModelAdapter = {
  id: "deepseek",

  getCapabilities(modelId: string): ModelCapabilities {
    return capabilitiesFor(modelId);
  },

  async complete(request: UnifiedModelRequest): Promise<UnifiedModelResult> {
    const capabilities = capabilitiesFor(request.modelId);
    const { applied, trace } = buildAppliedParameters(
      request.generation,
      capabilities,
    );

    const startedAt = Date.now();

    const result = await withRetries(request.maxRetries, () =>
      callDeepSeek(
        {
          model: request.modelId,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: request.input },
          ],
          stream: false,
          max_tokens: request.generation.maxOutputTokens,
          ...(applied.temperature !== undefined
            ? { temperature: applied.temperature }
            : {}),
          ...(applied.topP !== undefined ? { top_p: applied.topP } : {}),
          ...(applied.presencePenalty !== undefined
            ? { presence_penalty: applied.presencePenalty }
            : {}),
          ...(applied.frequencyPenalty !== undefined
            ? { frequency_penalty: applied.frequencyPenalty }
            : {}),
          ...(applied.thinkingMode !== undefined
            ? { thinking: { type: applied.thinkingMode } }
            : {}),
          ...(applied.reasoningEffort !== undefined
            ? { reasoning_effort: applied.reasoningEffort }
            : {}),
        },
        request.timeoutMs,
      ),
    );

    const latencyMs = Date.now() - startedAt;
    const choice = result.choices?.[0];
    const text = choice?.message?.content ?? "";

    if (!text.trim()) {
      throw new AppError("EMPTY_MODEL_OUTPUT", "DeepSeek 返回了空内容");
    }

    return {
      provider: "deepseek",
      modelId: request.modelId,
      responseId: result.id ?? null,
      text,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens ?? null,
            outputTokens: result.usage.completion_tokens ?? null,
            totalTokens: result.usage.total_tokens ?? null,
            cachedInputTokens: result.usage.prompt_cache_hit_tokens ?? null,
            reasoningTokens:
              result.usage.completion_tokens_details?.reasoning_tokens ?? null,
            source: "provider",
          }
        : UNAVAILABLE_USAGE,
      latencyMs,
      appliedParameters: trace,
      finishReason: mapFinishReason(choice?.finish_reason),
    };
  },

  async testConnection(modelId: string) {
    const startedAt = Date.now();
    try {
      await callDeepSeek(
        {
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 16,
          stream: false,
        },
        30_000,
      );
      return { ok: true, message: "连接成功", latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof AppError ? error.message : "连接失败",
        latencyMs: null,
      };
    }
  },
};
