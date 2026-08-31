import { z } from "zod";
import { energyLevelSchema } from "./common";

export const energySignalSchema = z.object({
  name: z.string(),
  matched: z.boolean(),
  contribution: z.number(),
});
export type EnergySignal = z.infer<typeof energySignalSchema>;

export const energyResolutionSchema = z.object({
  level: energyLevelSchema,
  source: z.enum(["manual", "rule_based", "override", "llm"]),
  reason: z.string(),
  signals: z.array(energySignalSchema),
});
export type EnergyResolution = z.infer<typeof energyResolutionSchema>;
