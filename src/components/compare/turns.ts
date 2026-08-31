import type { Conversation, ConversationMessage } from "@/domain/conversation";
import type { RunSummary } from "@/domain/run";
import type { ModelSlot } from "@/domain/settings";

export interface LaneCell {
  slot: ModelSlot;
  message: ConversationMessage | null;
  run: RunSummary | null;
}

export interface Turn {
  comparisonGroupId: string;
  userMessage: ConversationMessage;
  lanes: LaneCell[];
  sharedContextHash: string | null;
  /** 本轮各槽位的完整上下文是否仍然完全一致。 */
  lanesShareContext: boolean;
}

/**
 * 按 comparisonGroupId 组装每一轮。
 * 某槽位没有 assistant 消息时保持为 null，由 UI 显示“调用失败”，
 * 绝不用其他槽位内容或任何预设文本填补。
 */
export function buildTurns(
  conversation: Conversation,
  runs: RunSummary[],
  slots: ModelSlot[],
): Turn[] {
  const runByKey = new Map<string, RunSummary>();
  for (const run of runs) {
    if (!run.comparisonGroupId || !run.modelSlotId) continue;
    runByKey.set(`${run.comparisonGroupId}:${run.modelSlotId}`, run);
  }

  const assistantByKey = new Map<string, ConversationMessage>();
  for (const message of conversation.messages) {
    if (message.role !== "assistant") continue;
    if (!message.comparisonGroupId || !message.modelSlotId) continue;
    assistantByKey.set(
      `${message.comparisonGroupId}:${message.modelSlotId}`,
      message,
    );
  }

  return conversation.messages
    .filter(
      (message): message is ConversationMessage & { comparisonGroupId: string } =>
        message.role === "user" && message.comparisonGroupId !== null,
    )
    .map((userMessage) => {
      const groupId = userMessage.comparisonGroupId;
      const lanes: LaneCell[] = slots
        .map((slot) => ({
          slot,
          message: assistantByKey.get(`${groupId}:${slot.id}`) ?? null,
          run: runByKey.get(`${groupId}:${slot.id}`) ?? null,
        }))
        // 该轮完全没有参与的槽位不展示空列。
        .filter((lane) => lane.message !== null || lane.run !== null);

      const laneHashes = new Set(
        lanes
          .map((lane) => lane.run?.contextHash)
          .filter((hash): hash is string => Boolean(hash)),
      );

      return {
        comparisonGroupId: groupId,
        userMessage,
        lanes,
        sharedContextHash: lanes.find((lane) => lane.run)?.run?.sharedContextHash ?? null,
        lanesShareContext: laneHashes.size <= 1,
      };
    });
}
