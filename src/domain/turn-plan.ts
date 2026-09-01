import { z } from "zod";
import { energyLevelSchema } from "./common";
import {
  majorEventTypeSchema,
  plannedWorldviewModeSchema,
  questionPreferenceSchema,
  responseModeSchema,
} from "./behavior-taxonomy";

/** §8.3：编译后的本轮回复计划。Context Builder 收到 pending 视为实现错误。 */
export const turnPlanSchema = z
  .object({
    energy: energyLevelSchema,
    responseMode: responseModeSchema,
    /** Router 判定的提问偏好，供 Turn Plan 渲染与 Inspector 复现。 */
    questionPreference: questionPreferenceSchema,
    majorEvent: z.object({
      matched: z.boolean(),
      firstMention: z.boolean(),
      type: majorEventTypeSchema.nullable(),
    }),
    responseBudget: z.object({
      targetMinChars: z.number().int().min(0),
      targetMaxChars: z.number().int().positive(),
      hardMaxChars: z.number().int().positive(),
      maxSentences: z.number().int().positive(),
      maxQuestions: z.number().int().min(0).max(1),
      maxActions: z.number().int().min(0).max(2),
      providerMaxOutputTokens: z.number().int().positive(),
    }),
    mustDo: z.array(z.string().min(1).max(200)).max(10),
    mustAvoid: z.array(z.string().min(1).max(200)).max(10),
    worldview: z.object({
      mode: plannedWorldviewModeSchema,
      source: z.enum(["none", "explicit", "organic"]),
      seedId: z.string().nullable(),
      canonFactIds: z.array(z.string()),
    }),
    selectedExampleId: z.string().nullable(),
  })
  .strict();
export type TurnPlan = z.infer<typeof turnPlanSchema>;

export function assertTurnPlanReadyForContext(plan: TurnPlan): void {
  if (plan.worldview.mode === "pending") {
    throw new Error("TurnPlan.worldview.mode 仍为 pending，不能构建 Context");
  }
}
