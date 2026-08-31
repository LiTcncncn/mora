import { z } from "zod";
import { idSchema, isoDateTimeSchema, recordedProviderIdSchema } from "./common";

export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationMessageSchema = z
  .object({
    id: idSchema,
    role: messageRoleSchema,
    content: z.string(),
    createdAt: isoDateTimeSchema,
    runId: idSchema.nullable(),
    /** user 消息为 null（全槽位共享）；assistant 消息必须归属一个槽位。 */
    modelSlotId: idSchema.nullable(),
    provider: recordedProviderIdSchema.nullable(),
    modelId: z.string().max(120).nullable(),
    comparisonGroupId: idSchema.nullable(),
  })
  .refine(
    (message) =>
      message.role === "user"
        ? message.modelSlotId === null
        : message.modelSlotId !== null,
    { message: "assistant 消息必须归属 modelSlotId，user 消息必须为 null" },
  );
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  title: z.string().min(1).max(120),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  messages: z.array(conversationMessageSchema),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationsDataSchema = z.object({
  items: z.array(conversationSchema),
});
export type ConversationsData = z.infer<typeof conversationsDataSchema>;

/**
 * 某个模型槽位可见的历史：全部 user 消息 + 该槽位自己的 assistant 消息。
 * 绝不跨槽位读取 assistant 消息。
 */
export function selectLaneMessages(
  conversation: Conversation,
  modelSlotId: string,
): ConversationMessage[] {
  return conversation.messages.filter(
    (message) =>
      message.role === "user" || message.modelSlotId === modelSlotId,
  );
}
