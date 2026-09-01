import { z } from "zod";
import { idSchema, providerIdSchema } from "./common";
import { turnPlanSchema } from "./turn-plan";
import { safetyResolutionSchema, turnRoutingResultSchema } from "./turn-routing";
import { worldviewTraceSchema } from "./worldview-schedule";

/** §16.1：行为示例检索追踪。 */
export const exampleRetrievalTraceSchema = z
  .object({
    enabled: z.boolean(),
    candidateCount: z.number().int().min(0),
    selectedExampleId: z.string().nullable(),
    selectedExampleName: z.string().nullable(),
    topScore: z.number().min(0).max(1).nullable(),
    minScore: z.number().min(0).max(1),
    rejectReason: z.string().max(200).nullable(),
    candidates: z
      .array(
        z.object({
          id: idSchema,
          name: z.string(),
          score: z.number().min(0).max(1),
          filtered: z.boolean(),
          filterReason: z.string().max(200).nullable(),
        }),
      )
      .max(20),
  })
  .strict();
export type ExampleRetrievalTrace = z.infer<typeof exampleRetrievalTraceSchema>;

/** §16.1：Router 调用元数据。 */
export const routerTraceSchema = z
  .object({
    provider: providerIdSchema,
    modelId: z.string().min(1).max(120),
    latencyMs: z.number().int().nonnegative(),
    retried: z.boolean(),
    retryReason: z.string().max(400).optional(),
  })
  .strict();
export type RouterTrace = z.infer<typeof routerTraceSchema>;

/** §16.1：Safety 区块。 */
export const safetyTraceSchema = safetyResolutionSchema
  .extend({
    latencyMs: z.number().int().nonnegative(),
    urgentPlaceholderUsed: z.boolean(),
    urgentPlaceholderText: z.string().nullable(),
  })
  .strict();
export type SafetyTrace = z.infer<typeof safetyTraceSchema>;

/**
 * §16.1：1.1 行为引擎追踪快照。
 * 写入 Run 记录，供 Inspector 复现「为何如此路由与编译」。
 */
export const behaviorTraceSchema = z
  .object({
    behaviorConfigHash: z.string(),
    taxonomyVersion: z.string(),
    energyPolicyVersion: z.string(),
    strategyPolicyVersion: z.string(),
    safety: safetyTraceSchema,
    routing: turnRoutingResultSchema,
    router: routerTraceSchema,
    turnPlan: turnPlanSchema,
    /** 编译器备注：如 invite 触发、major event 压缩等。 */
    compileNotes: z.array(z.string().max(400)).max(20),
    worldview: worldviewTraceSchema,
    exampleRetrieval: exampleRetrievalTraceSchema,
  })
  .strict();
export type BehaviorTrace = z.infer<typeof behaviorTraceSchema>;
