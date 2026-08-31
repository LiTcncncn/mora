import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";
import type { RunRecord } from "./run";

/**
 * 首版不实现评分 UI，也不写入 evaluation。
 * 此处只保留 schema 与 hook 接口，供未来扩展。
 */
export const evaluationDimensionSchema = z.enum([
  "warmth",
  "relevance",
  "brevity",
  "persona_consistency",
  "energy_appropriateness",
  "helpfulness",
  "safety",
]);
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;

export const runEvaluationSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  runId: idSchema,
  comparisonGroupId: idSchema.nullable(),
  scores: z.record(
    evaluationDimensionSchema,
    z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  ),
  thumb: z.enum(["up", "down"]).nullable(),
  verdict: z.enum(["left", "right", "tie", "neither"]).nullable(),
  tags: z.array(z.string()),
  comment: z.string(),
  evaluator: z.enum(["human", "hook"]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type RunEvaluation = z.infer<typeof runEvaluationSchema>;

export const evalsDataSchema = z.object({
  items: z.array(runEvaluationSchema),
});
export type EvalsData = z.infer<typeof evalsDataSchema>;

export interface EvaluationHookInput {
  run: RunRecord;
  comparisonRuns?: RunRecord[];
}

export interface EvaluationHookResult {
  evaluator: "hook";
  scores: Partial<Record<EvaluationDimension, number>>;
  tags: string[];
  comment: string;
}

export interface EvaluationHook {
  id: string;
  enabled: boolean;
  evaluate(input: EvaluationHookInput): Promise<EvaluationHookResult>;
}

export const noopEvaluationHook: EvaluationHook = {
  id: "noop",
  enabled: false,
  async evaluate() {
    return { evaluator: "hook", scores: {}, tags: [], comment: "" };
  },
};
