import type { ConversationMessage } from "@/domain/conversation";
import type { FewShotSample } from "@/domain/fewshot";
import type { MemoryItem } from "@/domain/memory";
import type { Persona } from "@/domain/persona";
import type { ContextSettings } from "@/domain/settings";

function describeLevel(value: number, labels: [string, string, string]): string {
  if (value < 0.34) return labels[0];
  if (value < 0.67) return labels[1];
  return labels[2];
}

const REPLY_LENGTH_TEXT: Record<Persona["style"]["defaultReplyLength"], string> =
  {
    very_short: "默认回复非常短，通常一两句",
    short: "默认回复偏短",
    medium: "默认回复中等长度",
    long: "默认回复可以较完整",
  };

const EMOJI_TEXT: Record<Persona["style"]["emojiMode"], string> = {
  none: "不使用 emoji",
  rare: "极少使用 emoji",
  light: "偶尔可以使用少量 emoji",
};

const QUESTION_TEXT: Record<Persona["style"]["questionFrequency"], string> = {
  low: "很少提问",
  medium: "适度提问",
  high: "较常提问",
};

/** 把 traits 数值转成可读文字，绝不把裸数值发给模型。 */
export function renderPersonaTraits(persona: Persona): string {
  const { traits, style } = persona;
  const lines = [
    `语气：${describeLevel(traits.warmth, ["克制", "温和", "很温暖"])}。`,
    `幽默：${describeLevel(traits.humor, ["几乎不开玩笑", "偶尔有一点轻微幽默", "比较爱开玩笑"])}。`,
    `主动性：${describeLevel(traits.initiative, ["很少主动引导话题", "偶尔轻轻跟进", "会比较主动推进对话"])}。`,
    `直接程度：${describeLevel(traits.directness, ["委婉", "适度直接", "比较直接"])}。`,
    `活泼度：${describeLevel(traits.playfulness, ["安静", "偶尔轻松一下", "比较活泼"])}。`,
    `${REPLY_LENGTH_TEXT[style.defaultReplyLength]}。`,
    `${EMOJI_TEXT[style.emojiMode]}。`,
    `${QUESTION_TEXT[style.questionFrequency]}。`,
  ];

  if (style.preferredPatterns.length > 0) {
    lines.push(`倾向的说话方式：${style.preferredPatterns.join("；")}。`);
  }
  if (style.avoidPatterns.length > 0) {
    lines.push(`避免这些表达：${style.avoidPatterns.join("；")}。`);
  }
  if (persona.relationshipFraming) {
    lines.push(`关系定位：${persona.relationshipFraming}`);
  }
  if (persona.boundaries.length > 0) {
    lines.push(`边界：${persona.boundaries.join("；")}。`);
  }

  return lines.join("\n");
}

/** 只输出用户原话与期望回复；scene、note 等元信息不进提示词。 */
export function renderFewShot(samples: FewShotSample[]): string {
  if (samples.length === 0) return "";
  return samples
    .map(
      (sample, index) =>
        `示例 ${index + 1}\n用户：${sample.user.trim()}\n你：${sample.reply.trim()}`,
    )
    .join("\n\n");
}

export function renderMemories(
  memories: MemoryItem[],
  settings: ContextSettings,
): string {
  if (memories.length === 0) return "（暂时没有相关的长期记忆）";
  return memories
    .map((memory) => {
      if (!settings.includeMemoryMetadata) return `- ${memory.content}`;
      return `- ${memory.content}（类型：${memory.type}；重要度：${memory.importance}）`;
    })
    .join("\n");
}

export function renderHistory(
  messages: ConversationMessage[],
  settings: ContextSettings,
): string {
  if (messages.length === 0) return "（这是你们的第一句对话）";
  return messages
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : "你";
      const timestamp = settings.includeTimestamps
        ? `[${message.createdAt}] `
        : "";
      return `${timestamp}${speaker}：${message.content}`;
    })
    .join("\n");
}

/** 按轮次裁剪历史，从最旧开始移除。 */
export function limitHistory(
  messages: ConversationMessage[],
  settings: ContextSettings,
): ConversationMessage[] {
  const maxMessages = settings.historyTurns * 2;
  let limited = messages.slice(Math.max(0, messages.length - maxMessages));

  while (limited.length > 0) {
    const rendered = renderHistory(limited, settings);
    if ([...rendered].length <= settings.maxHistoryChars) break;
    limited = limited.slice(1);
  }
  return limited;
}
