import type { FinishReason, ProviderId, TokenUsage } from "@/domain/common";
import type { AppliedParameter } from "@/domain/run";
import type { GenerationSettings } from "@/domain/settings";

export interface ModelCapabilities {
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsPresencePenalty: boolean;
  supportsFrequencyPenalty: boolean;
  supportsSeed: boolean;
  supportsThinkingMode: boolean;
  supportsReasoningEffort: boolean;
  supportsVerbosity: boolean;
  supportsStreaming: boolean;
  reportsUsage: boolean;
}

export interface UnifiedModelRequest {
  provider: ProviderId;
  modelId: string;
  instructions: string;
  input: string;
  generation: GenerationSettings;
  timeoutMs: number;
  maxRetries: number;
  metadata: {
    runId: string;
    conversationId: string;
    sharedContextHash: string;
    contextHash: string;
  };
}

export interface UnifiedModelResult {
  provider: ProviderId;
  modelId: string;
  responseId: string | null;
  /** 供应商返回的完整文本，绝不在应用层截断或改写。 */
  text: string;
  usage: TokenUsage;
  latencyMs: number;
  appliedParameters: AppliedParameter[];
  finishReason: FinishReason;
}

export interface ModelAdapter {
  id: ProviderId;
  getCapabilities(modelId: string): ModelCapabilities;
  complete(request: UnifiedModelRequest): Promise<UnifiedModelResult>;
  testConnection(modelId: string): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number | null;
  }>;
}

export const UNAVAILABLE_USAGE: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  source: "unavailable",
};

export function notApplied(
  name: string,
  requestedValue: unknown,
  reason: string,
): AppliedParameter {
  return {
    name,
    requestedValue,
    appliedValue: null,
    status: "not_applied",
    reason,
  };
}

export function applied(name: string, value: unknown): AppliedParameter {
  return {
    name,
    requestedValue: value,
    appliedValue: value,
    status: "applied",
  };
}

export function transformed(
  name: string,
  requestedValue: unknown,
  appliedValue: unknown,
  reason: string,
): AppliedParameter {
  return {
    name,
    requestedValue,
    appliedValue,
    status: "transformed",
    reason,
  };
}

/**
 * 依据 capability 过滤参数。
 * 不支持的参数必须记录为 not_applied，绝不静默伪装成已生效。
 */
export function buildAppliedParameters(
  generation: GenerationSettings,
  capabilities: ModelCapabilities,
): { applied: Record<string, unknown>; trace: AppliedParameter[] } {
  const trace: AppliedParameter[] = [];
  const output: Record<string, unknown> = {};

  const consider = (
    name: keyof GenerationSettings,
    supported: boolean,
    reason: string,
  ): void => {
    const value = generation[name];
    if (value === null || value === undefined) return;
    if (!supported) {
      trace.push(notApplied(name, value, reason));
      return;
    }
    output[name] = value;
    trace.push(applied(name, value));
  };

  consider("temperature", capabilities.supportsTemperature, "当前模型不支持 temperature");
  consider("topP", capabilities.supportsTopP, "当前模型不支持 top_p");
  consider(
    "presencePenalty",
    capabilities.supportsPresencePenalty,
    "当前模型不支持 presence_penalty",
  );
  consider(
    "frequencyPenalty",
    capabilities.supportsFrequencyPenalty,
    "当前模型不支持 frequency_penalty",
  );
  consider("seed", capabilities.supportsSeed, "当前模型不支持 seed");
  consider(
    "thinkingMode",
    capabilities.supportsThinkingMode,
    "当前模型不支持 thinking mode",
  );
  consider(
    "reasoningEffort",
    capabilities.supportsReasoningEffort,
    "当前模型不支持 reasoning effort",
  );
  consider("verbosity", capabilities.supportsVerbosity, "当前模型不支持 verbosity");

  output.maxOutputTokens = generation.maxOutputTokens;
  trace.push(applied("maxOutputTokens", generation.maxOutputTokens));

  return { applied: output, trace };
}
