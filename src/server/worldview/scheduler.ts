import type {
  WorldviewScheduleState,
  WorldviewSchedulerBranch,
} from "@/domain/worldview-schedule";
import type { WorldviewSettings } from "@/domain/worldview-v2";
import { fnv1aUnit } from "./hash-unit";

export interface WorldviewScheduleProposal {
  scheduled: boolean;
  branch: WorldviewSchedulerBranch | null;
  trace: {
    credit: number;
    rollingNeed: number;
    unit: number;
    jitter: number;
    threshold: number;
  };
  preState: WorldviewScheduleState;
  postState: WorldviewScheduleState;
}

function cloneState(state: WorldviewScheduleState): WorldviewScheduleState {
  return {
    ...state,
    rollingOutcomes: [...state.rollingOutcomes],
    recentSeedIds: state.recentSeedIds.map((entry) => ({ ...entry })),
  };
}

function computeRollingNeed(
  state: WorldviewScheduleState,
  settings: WorldviewSettings,
): number {
  const retained = state.rollingOutcomes.slice(
    -(settings.rollingEligibleWindow - 1),
  );
  const recentCount = retained.filter(Boolean).length;
  const windowSize = retained.length + 1;
  return settings.organicTargetRate * windowSize - recentCount;
}

function computeThreshold(
  state: WorldviewScheduleState,
  settings: WorldviewSettings,
): { unit: number; jitter: number; threshold: number } {
  const unit = fnv1aUnit(
    `${state.scheduleSeed}:${state.eligibleIndex}:${state.schedulerAlgorithmVersion}`,
  );
  const jitter = -0.15 + unit * 0.3;
  return { unit, jitter, threshold: 1 + jitter };
}

/** §9.5 credit-v1：只产出提议，不直接落库。 */
export function proposeWorldviewSchedule(input: {
  preState: WorldviewScheduleState;
  settings: WorldviewSettings;
  eligibleTurn: boolean;
  assistantTurnsSinceAnyWorldview: number | null;
}): WorldviewScheduleProposal {
  const preState = cloneState(input.preState);
  const { settings, eligibleTurn } = input;

  const credit = Math.min(
    preState.credit + (eligibleTurn ? settings.organicTargetRate : 0),
    2,
  );
  preState.credit = credit;

  const rollingNeed = eligibleTurn
    ? computeRollingNeed(preState, settings)
    : 0;
  const { unit, jitter, threshold } = computeThreshold(preState, settings);

  let scheduled = false;
  let branch: WorldviewSchedulerBranch | null = null;
  const postState = cloneState(preState);

  if (!eligibleTurn) {
    branch = "2";
  } else if (
    postState.eligibleTurnsSinceLastOrganic <
    settings.minEligibleTurnsBetweenOrganic
  ) {
    branch = "3";
  } else if (
    input.assistantTurnsSinceAnyWorldview !== null &&
    input.assistantTurnsSinceAnyWorldview <
      settings.minAssistantTurnsBetweenAnyWorldview
  ) {
    branch = "4";
  } else if (rollingNeed > 0 && credit >= threshold) {
    scheduled = true;
    branch = "5a";
  } else if (
    postState.eligibleTurnsSinceLastOrganic >=
      settings.maxEligibleTurnsBetweenOrganic &&
    credit >= 0.5
  ) {
    scheduled = true;
    branch = "5b";
  } else {
    branch = "6";
  }

  if (eligibleTurn) {
    postState.lifetimeEligibleCount += 1;
    if (scheduled) {
      postState.credit = credit - 1;
      postState.eligibleTurnsSinceLastOrganic = 0;
      postState.assistantTurnsSinceAnyWorldview = 0;
      postState.rollingOutcomes = [
        ...postState.rollingOutcomes.slice(-(settings.rollingEligibleWindow - 1)),
        true,
      ];
      postState.lifetimeOrganicCount += 1;
    } else {
      postState.eligibleTurnsSinceLastOrganic += 1;
      postState.rollingOutcomes = [
        ...postState.rollingOutcomes.slice(-(settings.rollingEligibleWindow - 1)),
        false,
      ];
    }
    postState.eligibleIndex += 1;
  }

  return {
    scheduled,
    branch,
    trace: { credit, rollingNeed, unit, jitter, threshold },
    preState,
    postState,
  };
}

/** §9.5.3：种子落空时按未命中提交。 */
export function commitMissedSchedule(
  preState: WorldviewScheduleState,
  settings: WorldviewSettings,
): WorldviewScheduleState {
  const next = cloneState(preState);
  next.lifetimeEligibleCount += 1;
  next.eligibleTurnsSinceLastOrganic += 1;
  next.eligibleIndex += 1;
  next.rollingOutcomes = [
    ...next.rollingOutcomes.slice(-(settings.rollingEligibleWindow - 1)),
    false,
  ];
  return next;
}

/** 世界观真正进入 Prompt 后提交 postState。 */
export function commitOrganicWorldview(input: {
  postState: WorldviewScheduleState;
  seedId: string;
  cooldownGroup: string;
  assistantTurnIndex: number;
}): WorldviewScheduleState {
  const next = cloneState(input.postState);
  next.recentSeedIds = [
    ...next.recentSeedIds,
    {
      seedId: input.seedId,
      cooldownGroup: input.cooldownGroup,
      assistantTurnIndex: input.assistantTurnIndex,
    },
  ].slice(-50);
  return next;
}
