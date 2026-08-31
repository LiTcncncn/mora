import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const memoryTypeSchema = z.enum([
  "profile",
  "preference",
  "event",
  "support_strategy",
  "boundary",
  "relationship",
  "other",
]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const MEMORY_TYPES: readonly MemoryType[] = [
  "profile",
  "preference",
  "event",
  "support_strategy",
  "boundary",
  "relationship",
  "other",
];

export const memoryStatusSchema = z.enum(["active", "candidate", "archived"]);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export const memoryItemSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  type: memoryTypeSchema,
  content: z.string().min(1).max(2000),
  importance: z.number().min(0).max(1),
  enabled: z.boolean(),
  pinned: z.boolean(),
  tags: z.array(z.string().min(1).max(40)).max(30),
  source: z.object({
    kind: z.enum(["manual", "conversation_candidate"]),
    conversationId: idSchema.optional(),
    messageId: idSchema.optional(),
  }),
  status: memoryStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
  useCount: z.number().int().nonnegative(),
  expiresAt: isoDateTimeSchema.nullable(),
});
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const memoriesDataSchema = z.object({
  items: z.array(memoryItemSchema),
});
export type MemoriesData = z.infer<typeof memoriesDataSchema>;

export const memorySelectionTraceSchema = z.object({
  memoryId: idSchema,
  selected: z.boolean(),
  scores: z.object({
    pinned: z.number(),
    importance: z.number(),
    recency: z.number(),
    keywordRelevance: z.number(),
    total: z.number(),
  }),
  reason: z.string(),
});
export type MemorySelectionTrace = z.infer<typeof memorySelectionTraceSchema>;
