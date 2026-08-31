import "server-only";
import type { FinishReason } from "@/domain/common";
import { AppError } from "../api/errors";
import { getKimiApiKey, getKimiBaseUrl } from "../config/env";
import {
  mapProviderError,
  ProviderTimeoutError,
  withRetries,
} from "./provider-error";
import { fetchWithConnectTimeout } from "./timed-fetch";
import {
  buildAppliedParameters,
  transformed,
  UNAVAILABLE_USAGE,
  type ModelAdapter,
  type ModelCapabilities,
  type UnifiedModelRequest,
  type UnifiedModelResult,
} from "./types";

interface KimiChoice {
  message?: { content?: string | null };
  finish_reason?: string | null;
}

interface KimiResponse {
  id?: string;
  choices?: KimiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
  };
  error?: { message?: string };
}

const K2_FIXED_TEMPERATURE = 0.6;

function isK2Family(modelId: string): boolean {
  return /^kimi-k2/i.test(modelId);
}

function capabilitiesFor(modelId: string): ModelCapabilities {
  const k2 = isK2Family(modelId);
  return {
    supportsTemperature: !k2,
    supportsTopP: true,
    supportsPresencePenalty: true,
    supportsFrequencyPenalty: true,
    supportsSeed: false,
    supportsThinkingMode: true,
    supportsReasoningEffort: !k2,
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
  const apiKey = getKimiApiKey();
  if (!apiKey) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Kimi 尚未配置 API Key");
  }
  return apiKey;
}

async function callKimi(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<KimiResponse> {
  const apiKey = requireApiKey();
  let response: Response;
  try {
    response = await fetchWithConnectTimeout(
      `${getKimiBaseUrl().replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /timeout/i.test(error.message))
    ) {
      throw new ProviderTimeoutError("Kimi", timeoutMs);
    }
    throw mapProviderError(
      "Kimi",
      null,
      error instanceof Error ? error.message : "未知错误",
    );
  }

  const text = await response.text();
  let parsed: KimiResponse;
  try {
    parsed = JSON.parse(text) as KimiResponse;
  } catch {
    throw mapProviderError("Kimi", response.status, "返回内容不是合法 JSON");
  }

  if (!response.ok) {
    throw mapProviderError(
      "Kimi",
      response.status,
      parsed.error?.message ?? `HTTP ${response.status}`,
    );
  }
  return parsed;
}

export const kimiAdapter: ModelAdapter = {
  id: "kimi",

  getCapabilities(modelId: string): ModelCapabilities {
    return capabilitiesFor(modelId);
  },

  async complete(request: UnifiedModelRequest): Promise<UnifiedModelResult> {
    const capabilities = capabilitiesFor(request.modelId);
    const { applied, trace } = buildAppliedParameters(
      request.generation,
      capabilities,
    );

    const k2 = isK2Family(request.modelId);
    if (k2) {
      applied.temperature = K2_FIXED_TEMPERATURE;
      const record = transformed(
        "temperature",
        request.generation.temperature,
        K2_FIXED_TEMPERATURE,
        "kimi-k2 系列只允许 temperature=0.6",
      );
      const existing = trace.findIndex((item) => item.name === "temperature");
      if (existing >= 0) trace[existing] = record;
      else trace.push(record);
    }

    const startedAt = Date.now();

    const result = await withRetries(request.maxRetries, () =>
      callKimi(
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
      throw new AppError("EMPTY_MODEL_OUTPUT", "Kimi 返回了空内容");
    }

    return {
      provider: "kimi",
      modelId: request.modelId,
      responseId: result.id ?? null,
      text,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens ?? null,
            outputTokens: result.usage.completion_tokens ?? null,
            totalTokens: result.usage.total_tokens ?? null,
            cachedInputTokens: result.usage.cached_tokens ?? null,
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
      await callKimi(
        {
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 16,
          stream: false,
          thinking: { type: "disabled" },
          ...(isK2Family(modelId) ? { temperature: K2_FIXED_TEMPERATURE } : {}),
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
