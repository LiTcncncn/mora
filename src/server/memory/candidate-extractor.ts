import "server-only";
import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "@/domain/conversation";
import { MEMORY_TYPES, type MemoryItem, type MemoryType } from "@/domain/memory";
import type { MemorySettings } from "@/domain/settings";
import { getAdapter } from "../adapters/registry";

const EXTRACTOR_INSTRUCTIONS = [
  "你是一个信息抽取程序，不是聊天助手。",
  "抽取对象只有「当前用户原话」。上文仅用于解开指代，不是用户生平。",
  "",
  "严格要求：",
  "- 只记住用户自己表达的稳定信息。禁止推断疾病、诊断、动机或未说出口的敏感属性。",
  "- 每条 content 离开这段对话必须仍能看懂：写出具体名称、事物或事件，不要写「对方所说的片段」「你说的那些」「刚才那些」「这些片段」。",
  "- 用户用「这些 / 刚才 / 你说的」指向上文时：用上文把指代还原成具体片名、场次、事物。多个陪伴回复说法不同，能列出具体名称就合并写入；对不上或无法还原，整条舍弃。",
  "- 陪伴回复里的情节是对方讲的，不是用户自述经历。用户只是表示喜欢时，写成「你表示喜欢对话中提到的《××》……」，不要写成用户自己看过或最爱某部电影。",
  "- 寒暄、嗯、好的、纯附和且无法还原对象时，返回 0 条。不确定就舍弃。",
  "- 不要把陪伴回复的整段描写抄进记忆。",
  "- 一次最多 5 条。每条简体中文、第二人称、不超过 120 字。例如“你最近在做项目交接”。",
  "- type 只能是：profile、preference、event、support_strategy、boundary、relationship、other。",
  "- importance 是 0 到 1 之间的小数。",
  "",
  '只输出 JSON：{"candidates":[{"type":"preference","content":"...","importance":0.6}]}',
  "不要输出 JSON 以外的任何文字或代码块标记。",
].join("\n");

const PRIOR_MESSAGE_LIMIT = 8;
const PRIOR_ASSISTANT_CHARS = 500;

/** 指代未展开、离开对话看不懂的条目，写入前丢掉。 */
const VACUOUS_REFERENCE =
  /对方所说|你(?:刚刚|刚才)?说的|这些片段|那些片段|上述(?:内容|片段)|前面提到的(?!《)/;

export interface ExtractionText {
  messageId: string;
  content: string;
}

export interface PriorContextLine {
  role: "user" | "assistant";
  label: string;
  content: string;
}

export interface ExtractCandidatesInput {
  profileId: string;
  conversationId: string;
  /** 本轮要抽取的用户原话。 */
  userTexts: ExtractionText[];
  /** 本轮用户开口之前的对话，只用于解开指代。 */
  priorContext?: PriorContextLine[];
  memorySettings: MemorySettings;
  timeoutMs: number;
}

interface RawCandidate {
  type?: string;
  content?: string;
  importance?: number;
}

export function parseCandidates(text: string): RawCandidate[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return [];

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      candidates?: RawCandidate[];
    };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch {
    return [];
  }
}

export function isGroundedMemoryContent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (!VACUOUS_REFERENCE.test(text)) return true;
  return /《[^》]{1,40}》/.test(text);
}

function clip(text: string, maxChars: number): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars).join("")}…`;
}

/**
 * 取焦点用户句之前的上下文。不要包含该句之后的陪伴回复，
 * 否则会把本轮新生成的内容误当成「你说的」所指。
 */
export function priorContextBeforeUserMessage(
  messages: ConversationMessage[],
  focusUserMessageId: string,
): PriorContextLine[] {
  const focusIndex = messages.findIndex(
    (message) => message.id === focusUserMessageId && message.role === "user",
  );
  const before =
    focusIndex === -1 ? messages : messages.slice(0, focusIndex);
  return before.slice(-PRIOR_MESSAGE_LIMIT).map((message) => {
    if (message.role === "user") {
      return { role: "user" as const, label: "用户", content: message.content };
    }
    const label = message.modelId
      ? `陪伴（${message.modelId}）`
      : "陪伴";
    return {
      role: "assistant" as const,
      label,
      content: clip(message.content, PRIOR_ASSISTANT_CHARS),
    };
  });
}

export function userTextsFromIds(
  messages: ConversationMessage[],
  messageIds: string[],
): ExtractionText[] {
  const allowed = new Set(messageIds);
  return messages
    .filter((message) => message.role === "user" && allowed.has(message.id))
    .map((message) => ({ messageId: message.id, content: message.content }));
}

function normalizeType(value: string | undefined): MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType)
    ? (value as MemoryType)
    : "other";
}

function renderExtractorInput(
  userTexts: ExtractionText[],
  priorContext: PriorContextLine[],
): string {
  const lines: string[] = [];
  if (priorContext.length > 0) {
    lines.push("上文（只用于解开指代，不要把陪伴讲的情节写成用户经历）：");
    for (const line of priorContext) {
      lines.push(`${line.label}：${line.content}`);
    }
    lines.push("");
  }
  lines.push("当前用户原话（只从这里抽取）：");
  for (const item of userTexts) {
    lines.push(`用户说：${item.content}`);
  }
  return lines.join("\n");
}

/**
 * 失败时直接抛出，由调用方显示“调用失败”。
 * 绝不返回预设候选或空结果冒充成功。
 */
export async function extractMemoryCandidates(
  input: ExtractCandidatesInput,
): Promise<MemoryItem[]> {
  const { profileId, conversationId, userTexts, memorySettings } = input;
  if (userTexts.length === 0) return [];

  const config = memorySettings.autoCandidateExtraction;
  const adapter = getAdapter(config.provider);
  const priorContext = input.priorContext ?? [];

  const result = await adapter.complete({
    provider: config.provider,
    modelId: config.modelId,
    instructions: EXTRACTOR_INSTRUCTIONS,
    input: renderExtractorInput(userTexts, priorContext),
    generation: {
      temperature: null,
      topP: null,
      maxOutputTokens: 800,
      presencePenalty: null,
      frequencyPenalty: null,
      seed: null,
      thinkingMode: "disabled",
      reasoningEffort: "none",
      verbosity: null,
    },
    timeoutMs: input.timeoutMs,
    maxRetries: 0,
    metadata: {
      runId: `extract-${randomUUID()}`,
      conversationId,
      sharedContextHash: "",
      contextHash: "",
    },
  });

  const timestamp = new Date().toISOString();
  const lastMessageId = userTexts[userTexts.length - 1]!.messageId;

  return parseCandidates(result.text)
    .filter(
      (candidate): candidate is RawCandidate & { content: string } =>
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0 &&
        isGroundedMemoryContent(candidate.content),
    )
    .slice(0, 5)
    .map((candidate) => ({
      id: `mem-${randomUUID()}`,
      profileId,
      type: normalizeType(candidate.type),
      content: candidate.content.trim().slice(0, 300),
      importance:
        typeof candidate.importance === "number"
          ? Math.min(1, Math.max(0, candidate.importance))
          : 0.5,
      enabled: true,
      pinned: false,
      tags: [],
      source: {
        kind: "conversation_candidate" as const,
        conversationId,
        messageId: lastMessageId,
      },
      status: memorySettings.autoCandidateExtraction.requireManualApproval
        ? ("candidate" as const)
        : ("active" as const),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
      useCount: 0,
      expiresAt: null,
    }));
}
