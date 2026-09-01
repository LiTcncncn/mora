import "server-only";
import type { BehaviorTrace } from "@/domain/behavior-trace";
import type { Conversation } from "@/domain/conversation";
import type { EnergyLevel } from "@/domain/common";
import type { MemoryItem } from "@/domain/memory";
import type { SettingsData } from "@/domain/settings";
import { selectLaneMessages } from "@/domain/conversation";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { WorldviewScheduleState } from "@/domain/worldview-schedule";
import { behaviorConfigRepository } from "../config/behavior-repository";
import { selectMemories } from "../memory/selector";
import { evaluateSafety } from "../safety/evaluate";
import { buildUrgentBypassRouting } from "../safety/urgent-bypass";
import { classifyTurn, routingToEnergyResolution } from "../router/classify";
import type { TurnRouterInput } from "@/domain/turn-routing";
import { buildCompileNotes, compileTurnPlan } from "../policy/turn-plan-compiler";
import type { TurnPlan } from "@/domain/turn-plan";
import type {
  SafetyResolution,
  TurnRoutingResult,
} from "@/domain/turn-routing";
import type { EnergyResolution } from "@/domain/energy";
import type { ClassifyTurnResult } from "../router/classify";
import { runRepository } from "../persistence/repositories";
import {
  confirmWorldviewInjection,
  finalizeBehaviorTurn,
} from "../worldview/finalize-behavior-turn";

export interface SharedTurnContext {
  behaviorConfig: BehaviorConfigV2;
  safety: SafetyResolution;
  routing: TurnRoutingResult;
  turnPlan: TurnPlan;
  energyResolution: EnergyResolution;
  selectedMemories: MemoryItem[];
  memoryTrace: ReturnType<typeof selectMemories>["trace"];
  urgentReply: string | null;
  routerMeta: Pick<ClassifyTurnResult, "latencyMs" | "retried" | "retryReason" | "provider" | "modelId">;
  safetyLatencyMs: number;
  compileNotes: string[];
  behaviorTrace: BehaviorTrace;
  /** §9.5.1：本轮结束后写回 conversation 的调度状态。 */
  worldviewScheduleStateCommit: WorldviewScheduleState;
}

function lastAssistantAskedQuestion(
  messages: Array<{ role: string; content: string }>,
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    return /[?？]/.test(message.content);
  }
  return false;
}

async function previousEnergyFromHistory(
  profileId: string,
  conversation: Conversation,
  modelSlotId: string,
): Promise<EnergyLevel | null> {
  const lane = selectLaneMessages(conversation, modelSlotId);
  for (let index = lane.length - 1; index >= 0; index -= 1) {
    const message = lane[index]!;
    if (message.role !== "assistant" || !message.runId) continue;
    try {
      const run = await runRepository.get(profileId, message.runId);
      return (
        run.behaviorTrace?.turnPlan.energy ?? run.contextSnapshot.energy.level
      );
    } catch {
      continue;
    }
  }
  return null;
}

async function buildRouterInput(
  profileId: string,
  userMessage: string,
  conversation: Conversation,
  modelSlotId: string,
  safety: SafetyResolution,
): Promise<TurnRouterInput> {
  const lane = selectLaneMessages(conversation, modelSlotId);
  const recent = lane.slice(-8).map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
  }));

  return {
    currentUserMessage: userMessage,
    recentCanonicalMessages: recent,
    previousEnergy: await previousEnergyFromHistory(
      profileId,
      conversation,
      modelSlotId,
    ),
    lastAssistantAskedQuestion: lastAssistantAskedQuestion(recent),
    safetyResolution: safety,
  };
}

function buildTrace(input: {
  config: BehaviorConfigV2;
  safety: SafetyResolution;
  safetyLatencyMs: number;
  urgentReply: string | null;
  urgentText: string | null;
  routing: TurnRoutingResult;
  routerMeta: SharedTurnContext["routerMeta"];
  turnPlan: TurnPlan;
  compileNotes: string[];
  worldview: BehaviorTrace["worldview"];
  exampleRetrieval: BehaviorTrace["exampleRetrieval"];
}): BehaviorTrace {
  return {
    behaviorConfigHash: input.config.configHash,
    taxonomyVersion: input.config.taxonomyVersion,
    energyPolicyVersion: input.config.energyPolicyVersion,
    strategyPolicyVersion: input.config.strategyPolicyVersion,
    safety: {
      ...input.safety,
      latencyMs: input.safetyLatencyMs,
      urgentPlaceholderUsed: input.urgentReply !== null,
      urgentPlaceholderText: input.urgentText,
    },
    routing: input.routing,
    router: {
      provider: input.routerMeta.provider,
      modelId: input.routerMeta.modelId,
      latencyMs: input.routerMeta.latencyMs,
      retried: input.routerMeta.retried,
      retryReason: input.routerMeta.retryReason,
    },
    turnPlan: input.turnPlan,
    compileNotes: input.compileNotes,
    worldview: input.worldview,
    exampleRetrieval: input.exampleRetrieval,
  };
}

/** Context 构建后确认世界观注入状态（§14 第 18 步）。 */
export function applyBehaviorTraceAfterContext(input: {
  behaviorTrace: BehaviorTrace;
  turnPlan: TurnPlan;
  renderedInstructions: string;
}): BehaviorTrace {
  const worldview = confirmWorldviewInjection({
    turnPlan: input.turnPlan,
    renderedInstructions: input.renderedInstructions,
    trace: input.behaviorTrace.worldview,
  });
  return { ...input.behaviorTrace, worldview };
}

/** Compare / Preview 共享的 1.1 行为管线。 */
export async function prepareSharedTurnContext(input: {
  profileId: string;
  profileName: string;
  userMessage: string;
  conversation: Conversation;
  modelSlotId: string;
  settings: Pick<SettingsData, "memory" | "energy">;
  memories: MemoryItem[];
  energyOverride?: EnergyLevel;
}): Promise<SharedTurnContext> {
  const behaviorConfig = await behaviorConfigRepository.get(
    input.profileId,
    input.profileName,
  );

  const safetyStarted = Date.now();
  const safety = evaluateSafety(input.userMessage, behaviorConfig.safety);
  const safetyLatencyMs = Date.now() - safetyStarted;

  const routerInput = await buildRouterInput(
    input.profileId,
    input.userMessage,
    input.conversation,
    input.modelSlotId,
    safety,
  );

  const urgentReply =
    safety.route === "urgent_support" &&
    behaviorConfig.safety.urgentPlaceholderEnabled
      ? behaviorConfig.safety.urgentPlaceholderText
      : null;

  const classified = urgentReply
    ? {
        routing: buildUrgentBypassRouting(),
        latencyMs: 0,
        retried: false,
        provider: behaviorConfig.router.provider,
        modelId: behaviorConfig.router.modelId,
      }
    : await classifyTurn(routerInput, behaviorConfig);
  const routing = classified.routing;

  const basePlan = compileTurnPlan({
    routing,
    config: behaviorConfig,
    safety,
    energyOverride: input.energyOverride,
    allowEnergyOverride: input.settings.energy.allowPerMessageOverride,
  });

  const finalized = finalizeBehaviorTurn({
    basePlan,
    routing,
    safety,
    config: behaviorConfig,
    conversation: input.conversation,
    userMessage: input.userMessage,
  });

  const turnPlan = finalized.turnPlan;

  const compileNotes = [
    ...buildCompileNotes({
      routing,
      plan: turnPlan,
      config: behaviorConfig,
      safety,
    }),
    ...finalized.worldviewTrace.notes,
  ];

  const energyMeta = routingToEnergyResolution(
    routing,
    input.energyOverride,
    input.settings.energy.allowPerMessageOverride,
  );

  const memorySelection = selectMemories({
    memories: input.memories,
    userMessage: input.userMessage,
    settings: input.settings.memory,
  });

  const routerMeta = {
    latencyMs: classified.latencyMs,
    retried: classified.retried,
    retryReason: classified.retryReason,
    provider: classified.provider,
    modelId: classified.modelId,
  };

  const behaviorTrace = buildTrace({
    config: behaviorConfig,
    safety,
    safetyLatencyMs,
    urgentReply,
    urgentText: urgentReply,
    routing,
    routerMeta,
    turnPlan,
    compileNotes,
    worldview: finalized.worldviewTrace,
    exampleRetrieval: finalized.exampleRetrieval,
  });

  return {
    behaviorConfig,
    safety,
    routing,
    turnPlan,
    energyResolution: {
      level: turnPlan.energy,
      source: energyMeta.source,
      reason: energyMeta.reason,
      signals: [],
    },
    selectedMemories: memorySelection.selected,
    memoryTrace: memorySelection.trace,
    urgentReply,
    routerMeta,
    safetyLatencyMs,
    compileNotes,
    behaviorTrace,
    worldviewScheduleStateCommit: finalized.scheduleState,
  };
}
