import "server-only";
import { randomUUID } from "node:crypto";
import { ENERGY_LEVELS, type EnergyLevel } from "@/domain/common";
import type { EnergySettings } from "@/domain/settings";
import { getAdapter } from "../adapters/registry";

const CLASSIFIER_INSTRUCTIONS = [
  "你是能量档位分类器，不是心理咨询师，也不是聊天助手。",
  "任务：根据用户这一句原话，判断TA当下还剩多少可用能量，用来决定陪伴回复该有多轻、多重。",
  "这是交互负担指标，禁止诊断、贴病理标签、推断未说出口的病因或人格。",
  "",
  "档位含义：",
  "- E0 几乎没电：很沉、很空、撑不住。回复仍要说完整但更轻，通常不建议；可以有一个非强制的轻问。若对方在邀约被问、想说说或抱怨没被问到，不要判成 E0。",
  "- E1 低电量：累但还能接几句，回复完整而短，最多一个很轻的问题或小动作。",
  "- E2 一般：还能聊聊，可以温和展开一点。",
  "- E3 有余力：想讨论、想计划，可以更完整地一起想。",
  "",
  "规则草稿只是关键词机械分，可能误判反话、玩笑、引用或复杂语气。请以整句语义为准，不要被单个词绑死。",
  "",
  '只输出 JSON：{"level":"E0"|"E1"|"E2"|"E3","reason":"一两句中文说明依据"}',
  "不要输出 JSON 以外的文字。",
].join("\n");

export interface RuleDraft {
  level: EnergyLevel;
  reason: string;
}

function parseLevel(text: string): { level: EnergyLevel; reason: string } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      level?: unknown;
      reason?: unknown;
    };
    if (
      typeof parsed.level !== "string" ||
      !ENERGY_LEVELS.includes(parsed.level as EnergyLevel)
    ) {
      return null;
    }
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 240)
        : "模型未给出说明";
    return { level: parsed.level as EnergyLevel, reason };
  } catch {
    return null;
  }
}

/** LLM 无法判定时返回 null，由调用方回退规则并写明原因。 */
export async function classifyEnergyWithLlm(input: {
  userMessage: string;
  settings: EnergySettings;
  ruleDraft: RuleDraft;
  timeoutMs: number;
}): Promise<{ level: EnergyLevel; reason: string } | null> {
  const { provider, modelId } = input.settings.llmClassifier;
  const adapter = getAdapter(provider);

  const result = await adapter.complete({
    provider,
    modelId,
    instructions: CLASSIFIER_INSTRUCTIONS,
    input: [
      `用户原话：${input.userMessage}`,
      `规则草稿档位：${input.ruleDraft.level}`,
      `规则草稿说明：${input.ruleDraft.reason}`,
    ].join("\n"),
    generation: {
      temperature: null,
      topP: null,
      maxOutputTokens: 200,
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
      runId: `energy-${randomUUID()}`,
      conversationId: "energy-classify",
      sharedContextHash: "",
      contextHash: "",
    },
  });

  return parseLevel(result.text);
}
