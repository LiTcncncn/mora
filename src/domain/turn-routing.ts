import { z } from "zod";
import { energyLevelSchema } from "./common";
import {
  majorEventResolutionSchema,
  questionPreferenceSchema,
  requestFlagSourceSchema,
  responseModeSchema,
  safetyLevelSchema,
  safetyRouteSchema,
  worldviewRelationSchema,
} from "./behavior-taxonomy";

/** §6.1：Safety 判定结果。 */
export const safetyResolutionSchema = z
  .object({
    level: safetyLevelSchema,
    matchedRuleIds: z.array(z.string()).max(500),
    route: safetyRouteSchema,
  })
  .strict();
export type SafetyResolution = z.infer<typeof safetyResolutionSchema>;

export const resolvedRequestFlagsSchema = z
  .object({
    wantsDetailedAnswer: z.boolean(),
    wantsMultiStepPlan: z.boolean(),
    source: requestFlagSourceSchema,
    evidence: z.array(z.string().max(400)).max(20),
  })
  .strict();
export type ResolvedRequestFlags = z.infer<typeof resolvedRequestFlagsSchema>;

export const worldviewRelationResultSchema = z
  .object({
    level: worldviewRelationSchema,
    tags: z.array(z.string().max(40)).max(20),
    referencedEntities: z.array(z.string().max(80)).max(20),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().max(400)).max(20),
  })
  .strict();
export type WorldviewRelationResult = z.infer<
  typeof worldviewRelationResultSchema
>;

/** §7.5：Turn Router 输出。 */
export const turnRoutingResultSchema = z
  .object({
    source: z.enum(["model", "rules", "fixed", "fallback"]),
    energy: z.object({
      level: energyLevelSchema,
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
    worldviewRelation: worldviewRelationResultSchema,
    requestFlags: resolvedRequestFlagsSchema,
    overallConfidence: z.number().min(0).max(1),
  })
  .strict();
export type TurnRoutingResult = z.infer<typeof turnRoutingResultSchema>;

/** §7.6：Router 输入（不含用户原文以外的完整上下文）。 */
export interface TurnRouterInput {
  currentUserMessage: string;
  recentCanonicalMessages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  previousEnergy: z.infer<typeof energyLevelSchema> | null;
  lastAssistantAskedQuestion: boolean;
  safetyResolution: SafetyResolution;
}
