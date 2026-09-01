import type { TurnRoutingResult } from "@/domain/turn-routing";

/** §6.2：urgent 时不调用 Router，Inspector 仍需要一份最小 routing 快照。 */
export function buildUrgentBypassRouting(): TurnRoutingResult {
  return {
    source: "fixed",
    energy: {
      level: "E0",
      confidence: 1,
      evidence: ["Safety urgent，跳过 Router"],
    },
    majorEvent: {
      matched: false,
      type: null,
      temporalStatus: null,
      subject: null,
      evidence: [],
    },
    questionPreference: {
      value: "avoid",
      confidence: 1,
      evidence: ["Safety urgent"],
    },
    responseMode: {
      value: "COMPANION",
      confidence: 1,
      evidence: ["Safety urgent"],
    },
    worldviewRelation: {
      level: "discouraged",
      tags: [],
      referencedEntities: [],
      confidence: 1,
      evidence: ["Safety urgent"],
    },
    requestFlags: {
      wantsDetailedAnswer: false,
      wantsMultiStepPlan: false,
      source: "rule",
      evidence: [],
    },
    overallConfidence: 1,
  };
}
