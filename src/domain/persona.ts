import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const personaSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  enabled: z.boolean(),
  corePrompt: z.string().min(1).max(8000),
  language: z.literal("zh-CN"),
  traits: z.object({
    warmth: z.number().min(0).max(1),
    humor: z.number().min(0).max(1),
    initiative: z.number().min(0).max(1),
    directness: z.number().min(0).max(1),
    playfulness: z.number().min(0).max(1),
  }),
  style: z.object({
    defaultReplyLength: z.enum(["very_short", "short", "medium", "long"]),
    emojiMode: z.enum(["none", "rare", "light"]),
    questionFrequency: z.enum(["low", "medium", "high"]),
    avoidPatterns: z.array(z.string().min(1).max(200)).max(50),
    preferredPatterns: z.array(z.string().min(1).max(200)).max(50),
  }),
  relationshipFraming: z.string().max(1000),
  boundaries: z.array(z.string().min(1).max(300)).max(50),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Persona = z.infer<typeof personaSchema>;

export const personasDataSchema = z.object({
  items: z.array(personaSchema),
});
export type PersonasData = z.infer<typeof personasDataSchema>;
