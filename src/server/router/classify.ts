import "server-only";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { EnergyLevel } from "@/domain/common";
import type { TurnRouterInput, TurnRoutingResult } from "@/domain/turn-routing";
import {
  classifyTurnFixed,
  classifyTurnFallback,
  classifyTurnRules,
} from "./fallback";
import { classifyTurnWithLlm } from "./llm-classifier";
import {
  mergeRequestFlags,
  resolveRequestFlagsByRules,
} from "./request-flags";

export interface ClassifyTurnResult {
  routing: TurnRoutingResult;
  latencyMs: number;
  retried: boolean;
  retryReason?: string;
  provider: BehaviorConfigV2["router"]["provider"];
  modelId: string;
}

/** Turn Router：llm 模式走轻量模型；失败或低置信度回退规则层。 */
export async function classifyTurn(
  input: TurnRouterInput,
  config: BehaviorConfigV2,
): Promise<ClassifyTurnResult> {
  const { router, requestFlags: requestFlagSettings } = config;
  const text = input.currentUserMessage.trim();
  const ruleFlags = resolveRequestFlagsByRules(text, requestFlagSettings);

  if (!router.enabled || router.mode === "rules") {
    const routing = classifyTurnRules(input, requestFlagSettings);
    return {
      routing,
      latencyMs: 0,
      retried: false,
      provider: router.provider,
      modelId: router.modelId,
    };
  }

  if (router.mode === "fixed") {
    const routing = classifyTurnFixed();
    return {
      routing,
      latencyMs: 0,
      retried: false,
      provider: router.provider,
      modelId: router.modelId,
    };
  }

  try {
    const llm = await classifyTurnWithLlm({
      routerInput: input,
      routerSettings: router,
      ruleFlags,
    });

    const routing = llm.routing;

    if (routing.overallConfidence < router.minOverallConfidence) {
      const fallback = classifyTurnFallback(input, requestFlagSettings);
      return {
        routing: {
          ...fallback,
          requestFlags: { ...fallback.requestFlags, source: "fallback" },
        },
        latencyMs: llm.latencyMs,
        retried: llm.retried,
        retryReason: llm.retryReason ?? "overallConfidence 低于阈值",
        provider: router.provider,
        modelId: router.modelId,
      };
    }

    return {
      routing,
      latencyMs: llm.latencyMs,
      retried: llm.retried,
      retryReason: llm.retryReason,
      provider: router.provider,
      modelId: router.modelId,
    };
  } catch {
    const fallback = classifyTurnFallback(input, requestFlagSettings);
    return {
      routing: {
        ...fallback,
        requestFlags: { ...fallback.requestFlags, source: "fallback" },
      },
      latencyMs: 0,
      retried: false,
      retryReason: "LLM 调用或解析失败",
      provider: router.provider,
      modelId: router.modelId,
    };
  }
}

export function routingToEnergyResolution(
  routing: TurnRoutingResult,
  override: EnergyLevel | undefined,
  allowOverride: boolean,
): {
  level: EnergyLevel;
  source: "router" | "override";
  reason: string;
} {
  if (override && allowOverride) {
    return {
      level: override,
      source: "override",
      reason: "本轮用户手动指定了能量档位",
    };
  }
  const evidence = routing.energy.evidence.join("；") || "Router 判定";
  return {
    level: routing.energy.level,
    source: "router",
    reason: `[${routing.source}] ${evidence}`,
  };
}
