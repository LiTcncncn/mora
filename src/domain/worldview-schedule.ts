import { z } from "zod";
import { idSchema } from "./common";
import { worldviewModeSchema } from "./behavior-taxonomy";

/** §9.5.1：每个 conversation 的调度状态（用户数据，不进配置导出）。 */
export const worldviewScheduleStateSchema = z
  .object({
    scheduleSeed: idSchema,
    schedulerAlgorithmVersion: z.string().min(1).max(40),
    eligibleIndex: z.number().int().min(0),
    credit: z.number().min(0).max(2),
    rollingOutcomes: z.array(z.boolean()).max(200),
    eligibleTurnsSinceLastOrganic: z.number().int().min(0),
    assistantTurnsSinceAnyWorldview: z.number().int().min(0).nullable(),
    recentSeedIds: z
      .array(
        z.object({
          seedId: idSchema,
          cooldownGroup: z.string().min(1).max(40),
          assistantTurnIndex: z.number().int().min(0),
        }),
      )
      .max(50),
    lifetimeEligibleCount: z.number().int().min(0),
    lifetimeOrganicCount: z.number().int().min(0),
  })
  .strict();
export type WorldviewScheduleState = z.infer<typeof worldviewScheduleStateSchema>;

export const worldviewSchedulerBranchSchema = z.enum([
  "1",
  "2",
  "3",
  "4",
  "5a",
  "5b",
  "6",
]);
export type WorldviewSchedulerBranch = z.infer<
  typeof worldviewSchedulerBranchSchema
>;

export const worldviewDropReasonSchema = z.enum([
  "not_scheduled",
  "no_seed_after_stage2",
  "relation_discouraged",
  "budget_trimmed",
  "explicit_w3",
  "weak_topic_match",
]);
export type WorldviewDropReason = z.infer<typeof worldviewDropReasonSchema>;

/** §9.5.1 / §16.1：Inspector 用的世界观追踪快照。 */
export const worldviewTraceSchema = z
  .object({
    relation: z.enum(["required", "eligible", "discouraged"]),
    eligibleTurn: z.boolean(),
    eligibleExcludeReason: z.string().max(200).nullable(),
    stage1CandidateCount: z.number().int().min(0),
    stage2CandidateCount: z.number().int().min(0),
    schedulerAlgorithmVersion: z.string(),
    scheduleSeed: idSchema,
    eligibleIndex: z.number().int().min(0),
    creditBefore: z.number().min(0).max(2),
    creditAfter: z.number().min(0).max(2),
    rollingNeed: z.number(),
    unit: z.number().min(0).max(1),
    jitter: z.number(),
    threshold: z.number(),
    branch: worldviewSchedulerBranchSchema.nullable(),
    worldviewScheduled: z.boolean(),
    worldviewInjected: z.boolean(),
    worldviewRealized: z.boolean().nullable(),
    worldviewDropReason: worldviewDropReasonSchema.nullable(),
    finalMode: worldviewModeSchema,
    seedId: z.string().nullable(),
    seedCooldownGroup: z.string().nullable(),
    canonFactIds: z.array(z.string()),
    selectedSeedTitle: z.string().nullable(),
    notes: z.array(z.string().max(200)).max(10),
  })
  .strict();
export type WorldviewTrace = z.infer<typeof worldviewTraceSchema>;

export function createInitialWorldviewScheduleState(input: {
  scheduleSeed: string;
  schedulerAlgorithmVersion: string;
}): WorldviewScheduleState {
  return {
    scheduleSeed: input.scheduleSeed,
    schedulerAlgorithmVersion: input.schedulerAlgorithmVersion,
    eligibleIndex: 0,
    credit: 0,
    rollingOutcomes: [],
    eligibleTurnsSinceLastOrganic: 0,
    assistantTurnsSinceAnyWorldview: null,
    recentSeedIds: [],
    lifetimeEligibleCount: 0,
    lifetimeOrganicCount: 0,
  };
}
