import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TurnRouterSettings } from "@/domain/behavior-config";
import {
  majorEventResolutionSchema,
  questionPreferenceSchema,
  responseModeSchema,
  worldviewRelationSchema,
} from "@/domain/behavior-taxonomy";
import type {
  ResolvedRequestFlags,
  TurnRouterInput,
  TurnRoutingResult,
} from "@/domain/turn-routing";
import { getAdapter } from "../adapters/registry";
import { buildRouterInputText, TURN_ROUTER_INSTRUCTIONS } from "./prompt";
import { mergeRequestFlags } from "./request-flags";

/** LLM 原始 JSON（不含 source / overallConfidence 由服务端补全）。 */
const llmRouterOutputSchema = z
  .object({
    energy: z.object({
      level: z.enum(["E0", "E1", "E2", "E3"]),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string().max(400)).max(20),
    }),
    majorEvent: majorEventResolutionSchema,
    questionPreference: z.object({
      value: questionPreferenceSchema,
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string().max(400)).max(20),
    }),
    responseMode: z.object({
      value: responseModeSchema,
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string().max(400)).max(20),
    }),
    worldviewRelation: z.object({
      level: worldviewRelationSchema,
      tags: z.array(z.string().max(40)).max(20),
      referencedEntities: z.array(z.string().max(80)).max(20),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string().max(400)).max(20),
    }),
    requestFlags: z.object({
      wantsDetailedAnswer: z.boolean(),
      wantsMultiStepPlan: z.boolean(),
      evidence: z.array(z.string().max(400)).max(20),
    }),
    overallConfidence: z.number().min(0).max(1),
  })
  .strict();

export type LlmRouterOutput = z.infer<typeof llmRouterOutputSchema>;

export class RouterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterParseError";
  }
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new RouterParseError("响应中未找到 JSON 对象");
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new RouterParseError("JSON 解析失败");
  }
}

export function parseLlmRouterOutput(text: string): LlmRouterOutput {
  const parsed = llmRouterOutputSchema.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    throw new RouterParseError(
      `Schema 校验失败：${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return parsed.data;
}

export function llmOutputToRouting(
  output: LlmRouterOutput,
  requestFlags: TurnRoutingResult["requestFlags"],
): TurnRoutingResult {
  return {
    source: "model",
    energy: output.energy,
    majorEvent: output.majorEvent,
    questionPreference: output.questionPreference,
    responseMode: output.responseMode,
    worldviewRelation: output.worldviewRelation,
    requestFlags,
    overallConfidence: output.overallConfidence,
  };
}

const RETRY_SOFT_LIMIT_MS = 8000;

export interface LlmClassifyResult {
  routing: TurnRoutingResult;
  latencyMs: number;
  retried: boolean;
  retryReason?: string;
}

/** §7.7：一次 LLM 调用完成五项路由判断 + requestFlags 模型侧信号。 */
export async function classifyTurnWithLlm(input: {
  routerInput: TurnRouterInput;
  routerSettings: TurnRouterSettings;
  ruleFlags: ResolvedRequestFlags;
}): Promise<LlmClassifyResult> {
  const { routerInput, routerSettings, ruleFlags } = input;
  const adapter = getAdapter(routerSettings.provider);
  const started = Date.now();

  const attempt = async (): Promise<LlmRouterOutput> => {
    const result = await adapter.complete({
      provider: routerSettings.provider,
      modelId: routerSettings.modelId,
      instructions: TURN_ROUTER_INSTRUCTIONS,
      input: buildRouterInputText({
        currentUserMessage: routerInput.currentUserMessage,
        recentCanonicalMessages: routerInput.recentCanonicalMessages,
        previousEnergy: routerInput.previousEnergy,
        lastAssistantAskedQuestion: routerInput.lastAssistantAskedQuestion,
        safetyLevel: routerInput.safetyResolution.level,
      }),
      generation: {
        temperature: routerSettings.temperature ?? 0,
        topP: null,
        maxOutputTokens: Math.min(routerSettings.maxOutputTokens, 500),
        presencePenalty: null,
        frequencyPenalty: null,
        seed: null,
        thinkingMode: "disabled",
        reasoningEffort: "none",
        verbosity: null,
      },
      timeoutMs: routerSettings.timeoutMs,
      maxRetries: 0,
      metadata: {
        runId: `router-${randomUUID()}`,
        conversationId: "turn-router",
        sharedContextHash: "",
        contextHash: "",
      },
    });
    return parseLlmRouterOutput(result.text);
  };

  let retried = false;
  let retryReason: string | undefined;
  const firstStarted = Date.now();

  try {
    const output = await attempt();
    const mergedFlags = mergeRequestFlags(ruleFlags, {
      wantsDetailedAnswer: output.requestFlags.wantsDetailedAnswer,
      wantsMultiStepPlan: output.requestFlags.wantsMultiStepPlan,
      evidence: output.requestFlags.evidence,
    });
    return {
      routing: llmOutputToRouting(output, mergedFlags),
      latencyMs: Date.now() - started,
      retried: false,
    };
  } catch (firstError) {
    const firstElapsed = Date.now() - firstStarted;
    const reason =
      firstError instanceof Error ? firstError.message : "未知错误";

    if (firstElapsed <= RETRY_SOFT_LIMIT_MS && routerSettings.maxRetries >= 1) {
      retried = true;
      retryReason = reason;
      try {
        const output = await attempt();
        const mergedFlags = mergeRequestFlags(ruleFlags, {
          wantsDetailedAnswer: output.requestFlags.wantsDetailedAnswer,
          wantsMultiStepPlan: output.requestFlags.wantsMultiStepPlan,
          evidence: output.requestFlags.evidence,
        });
        return {
          routing: llmOutputToRouting(output, mergedFlags),
          latencyMs: Date.now() - started,
          retried: true,
          retryReason,
        };
      } catch (secondError) {
        throw secondError instanceof Error ? secondError : new Error(String(secondError));
      }
    }
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }
}
