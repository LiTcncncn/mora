import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { ExampleRetrievalTrace } from "@/domain/behavior-trace";
import type { Conversation } from "@/domain/conversation";
import type { TurnPlan } from "@/domain/turn-plan";
import type { SafetyResolution, TurnRoutingResult } from "@/domain/turn-routing";
import type {
  WorldviewScheduleState,
  WorldviewTrace,
} from "@/domain/worldview-schedule";
import { createInitialWorldviewScheduleState } from "@/domain/worldview-schedule";
import { retrieveBehaviorExample } from "../example/retrieve";
import { applyCasualChatOverrides } from "../policy/casual-chat-policy";
import { enrichTurnPlanWithWorldview } from "../policy/worldview-turn-plan";
import { retrieveCanonFacts } from "./canon-retrieval";
import { evaluateEligibleTurn } from "./eligible-turn";
import {
  getEnergyAllowedModes,
  intersectWorldviewModes,
  pickOrganicWorldviewMode,
} from "./energy-modes";
import {
  commitMissedSchedule,
  commitOrganicWorldview,
  proposeWorldviewSchedule,
  type WorldviewScheduleProposal,
} from "./scheduler";
import {
  filterSeedsStage1,
  filterSeedsStage2,
  pickBestSeed,
} from "./seed-filter";

export interface FinalizeBehaviorTurnResult {
  turnPlan: TurnPlan;
  worldviewTrace: WorldviewTrace;
  exampleRetrieval: ExampleRetrievalTrace;
  scheduleState: WorldviewScheduleState;
  proposal: WorldviewScheduleProposal | null;
}

function countAssistantTurns(conversation: Conversation): number {
  return conversation.messages.filter((message) => message.role === "assistant")
    .length;
}

function resolveScheduleState(
  conversation: Conversation,
  config: BehaviorConfigV2,
): WorldviewScheduleState {
  if (conversation.worldviewScheduleState) {
    return conversation.worldviewScheduleState;
  }
  return createInitialWorldviewScheduleState({
    scheduleSeed: `sched-${conversation.id}`,
    schedulerAlgorithmVersion: config.worldview.schedulerAlgorithmVersion,
  });
}

/** §14 第 8–16 步：在基础 Turn Plan 上回填世界观与示例卡。 */
export function finalizeBehaviorTurn(input: {
  basePlan: TurnPlan;
  routing: TurnRoutingResult;
  safety: SafetyResolution;
  config: BehaviorConfigV2;
  conversation: Conversation;
  userMessage: string;
}): FinalizeBehaviorTurnResult {
  const { routing, safety, config, conversation, userMessage } = input;
  const basePlan = applyCasualChatOverrides(input.basePlan, userMessage);
  const preState = resolveScheduleState(conversation, config);
  const assistantTurnIndex = countAssistantTurns(conversation);
  const settings = config.worldview;

  const filterContext = {
    responseMode: basePlan.responseMode,
    energy: basePlan.energy,
    majorEventType: basePlan.majorEvent.type,
    assistantTurnIndex,
    scheduleState: preState,
    settings,
  };

  const stage1 = filterSeedsStage1(config.worldviewSeeds, filterContext);
  const eligible = evaluateEligibleTurn({
    routing,
    safety,
    plan: basePlan,
    config,
    stage1CandidateCount: stage1.length,
  });

  const notes: string[] = [];
  let proposal: WorldviewScheduleProposal | null = null;
  let scheduleState = preState;
  let turnPlan: TurnPlan = {
    ...basePlan,
    worldview: { ...basePlan.worldview, mode: "pending" },
  };

  let worldviewTrace: WorldviewTrace = {
    relation: routing.worldviewRelation.level,
    eligibleTurn: eligible.eligible,
    eligibleExcludeReason: eligible.reason,
    stage1CandidateCount: stage1.length,
    stage2CandidateCount: 0,
    schedulerAlgorithmVersion: preState.schedulerAlgorithmVersion,
    scheduleSeed: preState.scheduleSeed,
    eligibleIndex: preState.eligibleIndex,
    creditBefore: preState.credit,
    creditAfter: preState.credit,
    rollingNeed: 0,
    unit: 0,
    jitter: 0,
    threshold: 0,
    branch: null,
    worldviewScheduled: false,
    worldviewInjected: false,
    worldviewRealized: null,
    worldviewDropReason: null,
    finalMode: "W0",
    seedId: null,
    seedCooldownGroup: null,
    canonFactIds: [],
    selectedSeedTitle: null,
    notes,
  };

  if (routing.worldviewRelation.level === "required") {
    const facts = retrieveCanonFacts(userMessage, config.canonFacts);
    turnPlan = {
      ...turnPlan,
      worldview: {
        mode: "W3",
        source: "explicit",
        seedId: null,
        canonFactIds: facts.map((fact) => fact.id),
      },
    };
    worldviewTrace = {
      ...worldviewTrace,
      branch: "1",
      finalMode: "W3",
      canonFactIds: facts.map((fact) => fact.id),
      worldviewInjected: facts.length > 0,
      worldviewDropReason: facts.length > 0 ? "explicit_w3" : null,
      notes: facts.length > 0 ? ["W3 Canon Facts 检索命中"] : ["W3 但未命中 Canon"],
    };
    scheduleState = {
      ...preState,
      assistantTurnsSinceAnyWorldview: 0,
    };
  } else if (routing.worldviewRelation.level === "discouraged") {
    turnPlan = {
      ...turnPlan,
      worldview: {
        mode: "W0",
        source: "none",
        seedId: null,
        canonFactIds: [],
      },
    };
    worldviewTrace = {
      ...worldviewTrace,
      finalMode: "W0",
      worldviewDropReason: "relation_discouraged",
      notes: ["用户要求无角色化回答"],
    };
  } else {
    proposal = proposeWorldviewSchedule({
      preState,
      settings,
      eligibleTurn: eligible.eligible,
      assistantTurnsSinceAnyWorldview: preState.assistantTurnsSinceAnyWorldview,
    });

    worldviewTrace = {
      ...worldviewTrace,
      creditBefore: preState.credit,
      creditAfter: proposal.trace.credit,
      rollingNeed: proposal.trace.rollingNeed,
      unit: proposal.trace.unit,
      jitter: proposal.trace.jitter,
      threshold: proposal.trace.threshold,
      branch: proposal.branch,
      worldviewScheduled: proposal.scheduled,
    };

    if (proposal.scheduled) {
      const energyAllowed = getEnergyAllowedModes({
        energy: basePlan.energy,
        responseMode: basePlan.responseMode,
      });
      const stage2 = filterSeedsStage2(stage1, filterContext, energyAllowed);
      worldviewTrace.stage2CandidateCount = stage2.length;

      if (stage2.length === 0) {
        turnPlan = {
          ...turnPlan,
          worldview: {
            mode: "W0",
            source: "none",
            seedId: null,
            canonFactIds: [],
          },
        };
        scheduleState = commitMissedSchedule(preState, settings);
        worldviewTrace = {
          ...worldviewTrace,
          finalMode: "W0",
          worldviewInjected: false,
          worldviewDropReason: "no_seed_after_stage2",
          creditAfter: scheduleState.credit,
          notes: ["调度命中但第二段过滤为空，按未命中提交"],
        };
      } else {
        const picked = pickBestSeed(stage2, {
          userMessage,
          responseMode: basePlan.responseMode,
          energy: basePlan.energy,
        });
        const seed = picked.seed;
        if (!seed) {
          turnPlan = {
            ...turnPlan,
            worldview: {
              mode: "W0",
              source: "none",
              seedId: null,
              canonFactIds: [],
            },
          };
          scheduleState = commitMissedSchedule(preState, settings);
          worldviewTrace = {
            ...worldviewTrace,
            finalMode: "W0",
            worldviewInjected: false,
            worldviewDropReason: "weak_topic_match",
            creditAfter: scheduleState.credit,
            notes: [
              `调度命中但种子话题匹配过低（${picked.topScore.toFixed(2)}），按未命中提交`,
            ],
          };
        } else {
        const mode = pickOrganicWorldviewMode(
          intersectWorldviewModes(energyAllowed, seed.allowedModes),
          {
            energy: basePlan.energy,
            responseMode: basePlan.responseMode,
          },
        );
        if (!mode) {
          turnPlan = {
            ...turnPlan,
            worldview: {
              mode: "W0",
              source: "none",
              seedId: null,
              canonFactIds: [],
            },
          };
          scheduleState = commitMissedSchedule(preState, settings);
          worldviewTrace = {
            ...worldviewTrace,
            finalMode: "W0",
            worldviewInjected: false,
            worldviewDropReason: "no_seed_after_stage2",
            creditAfter: scheduleState.credit,
            notes: ["种子强度交集为空"],
          };
        } else {
          turnPlan = {
            ...turnPlan,
            worldview: {
              mode,
              source: "organic",
              seedId: seed.id,
              canonFactIds: seed.canonFactIds,
            },
          };
          scheduleState = commitOrganicWorldview({
            postState: proposal.postState,
            seedId: seed.id,
            cooldownGroup: seed.cooldownGroup,
            assistantTurnIndex,
          });
          worldviewTrace = {
            ...worldviewTrace,
            finalMode: mode,
            seedId: seed.id,
            seedCooldownGroup: seed.cooldownGroup,
            selectedSeedTitle: seed.title,
            canonFactIds: seed.canonFactIds,
            worldviewInjected: true,
            creditAfter: scheduleState.credit,
            notes: [`选中种子 ${seed.title}（匹配 ${picked.topScore.toFixed(2)}）`],
          };
        }
        }
      }
    } else {
      turnPlan = {
        ...turnPlan,
        worldview: {
          mode: "W0",
          source: "none",
          seedId: null,
          canonFactIds: [],
        },
      };
      scheduleState = eligible.eligible ? proposal.postState : preState;
      worldviewTrace = {
        ...worldviewTrace,
        finalMode: "W0",
        creditAfter: scheduleState.credit,
        worldviewDropReason: "not_scheduled",
      };
    }
  }

  if (
    turnPlan.worldview.mode !== "W0" &&
    routing.worldviewRelation.level !== "required"
  ) {
    scheduleState = {
      ...scheduleState,
      assistantTurnsSinceAnyWorldview: 0,
    };
  } else if (routing.worldviewRelation.level !== "required") {
    scheduleState = {
      ...scheduleState,
      assistantTurnsSinceAnyWorldview:
        (scheduleState.assistantTurnsSinceAnyWorldview ?? 0) + 1,
    };
  }

  let example = retrieveBehaviorExample({
    cards: config.exampleCards,
    settings: config.exampleRetrieval,
    userMessage,
    responseMode: turnPlan.responseMode,
    energy: turnPlan.energy,
    questionPreference: routing.questionPreference.value,
    majorEventMatched: turnPlan.majorEvent.matched,
  });

  if (
    turnPlan.worldview.mode === "W1" ||
    turnPlan.worldview.mode === "W2"
  ) {
    example = {
      exampleId: null,
      trace: {
        ...example.trace,
        selectedExampleId: null,
        selectedExampleName: null,
        rejectReason: `本轮为 ${turnPlan.worldview.mode}，示例卡不与世界观种子混用`,
      },
    };
  }

  turnPlan = {
    ...turnPlan,
    selectedExampleId: example.exampleId,
  };

  turnPlan = enrichTurnPlanWithWorldview(turnPlan, config, userMessage);

  return {
    turnPlan,
    worldviewTrace,
    exampleRetrieval: example.trace,
    scheduleState,
    proposal,
  };
}

/** Context 构建完成后确认世界观是否仍在 Prompt 中（§16.1 D53）。 */
export function confirmWorldviewInjection(input: {
  turnPlan: TurnPlan;
  renderedInstructions: string;
  trace: WorldviewTrace;
}): WorldviewTrace {
  const { turnPlan, renderedInstructions, trace } = input;
  if (turnPlan.worldview.mode === "W0") {
    return trace;
  }
  if (turnPlan.worldview.mode === "W3") {
    const injected = turnPlan.worldview.canonFactIds.some((factId) =>
      renderedInstructions.includes(factId),
    ) || renderedInstructions.includes("Canon");
    if (!injected && trace.worldviewInjected) {
      return {
        ...trace,
        worldviewInjected: false,
        worldviewDropReason: "budget_trimmed",
        notes: [...trace.notes, "Context 预算裁剪后未检测到 Canon 注入"],
      };
    }
    return trace;
  }
  if (turnPlan.worldview.seedId) {
    const injected =
      renderedInstructions.includes(turnPlan.worldview.seedId) ||
      renderedInstructions.includes("【本轮显性陪衬 · 融入情绪，不是介绍环境】") ||
      (trace.selectedSeedTitle !== null &&
        renderedInstructions.includes(trace.selectedSeedTitle));
    if (!injected && trace.worldviewInjected) {
      return {
        ...trace,
        worldviewInjected: false,
        worldviewDropReason: "budget_trimmed",
        notes: [...trace.notes, "Context 预算裁剪后未检测到种子注入"],
      };
    }
  }
  return trace;
}
