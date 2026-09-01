import type { EnergyLevel } from "@/domain/common";
import type { EnergyResolution, EnergySignal } from "@/domain/energy";
import type { EnergySettings } from "@/domain/settings";
import { classifyEnergyWithLlm } from "./llm-classifier";

const LEVEL_ORDER: EnergyLevel[] = ["E0", "E1", "E2", "E3"];

function clampLevelIndex(index: number): number {
  return Math.min(LEVEL_ORDER.length - 1, Math.max(0, index));
}

function countExhaustionPunctuation(text: string): number {
  const matches = text.match(/[.。…]{2,}|~{2,}|\.{3,}/g);
  return matches ? matches.length : 0;
}

export function resolveEnergyByRules(
  userMessage: string,
  settings: EnergySettings,
): EnergyResolution {
  const text = userMessage.trim();
  const lower = text.toLowerCase();
  const signals: EnergySignal[] = [];
  let score = 0;

  const matchedLow = settings.ruleBased.lowEnergyKeywords.filter((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  signals.push({
    name: `低能量关键词（${matchedLow.join("、") || "无"}）`,
    matched: matchedLow.length > 0,
    contribution: -matchedLow.length,
  });
  score -= matchedLow.length;

  const matchedHigh = settings.ruleBased.highEnergyKeywords.filter((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  signals.push({
    name: `高能量关键词（${matchedHigh.join("、") || "无"}）`,
    matched: matchedHigh.length > 0,
    contribution: matchedHigh.length,
  });
  score += matchedHigh.length;

  const isShort = text.length <= settings.ruleBased.shortMessageThreshold;
  signals.push({
    name: `消息长度 ${text.length} ≤ 阈值 ${settings.ruleBased.shortMessageThreshold}`,
    matched: isShort,
    contribution: isShort ? -1 : 0,
  });
  if (isShort) score -= 1;

  const punctuation = countExhaustionPunctuation(text);
  const punctuationContribution =
    -punctuation * settings.ruleBased.exhaustionPunctuationWeight;
  signals.push({
    name: `疲惫式标点出现 ${punctuation} 次`,
    matched: punctuation > 0,
    contribution: punctuationContribution,
  });
  score += punctuationContribution;

  const baseIndex = LEVEL_ORDER.indexOf(settings.manualLevel);
  const level =
    LEVEL_ORDER[clampLevelIndex(baseIndex + Math.round(score))] ?? "E1";

  return {
    level,
    source: "rule_based",
    reason: `以设置档位 ${settings.manualLevel} 为基准，规则总分 ${score.toFixed(2)}，得到 ${level}`,
    signals,
  };
}

/**
 * 完全可解释：手动 / 规则 / LLM。
 * LLM 失败时回退规则，并在 reason 中写明，不静默假装模型成功。
 */
export async function resolveEnergy(input: {
  userMessage: string;
  settings: EnergySettings;
  override?: EnergyLevel | undefined;
  timeoutMs?: number;
}): Promise<EnergyResolution> {
  const { userMessage, settings, override } = input;

  if (override && settings.allowPerMessageOverride) {
    return {
      level: override,
      source: "override",
      reason: "本轮用户手动指定了能量档位",
      signals: [],
    };
  }

  if (settings.mode === "manual") {
    return {
      level: settings.manualLevel,
      source: "manual",
      reason: "Energy 模式为 manual，使用设置中的固定档位",
      signals: [],
    };
  }

  const ruleResult = settings.ruleBased.enabled
    ? resolveEnergyByRules(userMessage, settings)
    : {
        level: settings.manualLevel,
        source: "rule_based" as const,
        reason: "规则判定已关闭，草稿使用设置中的固定档位",
        signals: [],
      };

  if (settings.mode === "llm") {
    try {
      const classified = await classifyEnergyWithLlm({
        userMessage,
        settings,
        ruleDraft: { level: ruleResult.level, reason: ruleResult.reason },
        timeoutMs: input.timeoutMs ?? 30_000,
      });
      if (!classified) {
        return {
          ...ruleResult,
          reason: `LLM 返回无法解析，已回退规则：${ruleResult.reason}`,
        };
      }
      return {
        level: classified.level,
        source: "llm",
        reason: classified.reason,
        signals: [
          ...ruleResult.signals,
          {
            name: `规则草稿 ${ruleResult.level}`,
            matched: true,
            contribution: 0,
          },
        ],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      return {
        ...ruleResult,
        reason: `LLM 判定失败（${detail}），已回退规则：${ruleResult.reason}`,
      };
    }
  }

  if (!settings.ruleBased.enabled) {
    return {
      level: settings.manualLevel,
      source: "manual",
      reason: "规则判定已关闭，使用设置中的固定档位",
      signals: [],
    };
  }

  return ruleResult;
}

export function renderEnergyPolicy(
  level: EnergyLevel,
  settings: EnergySettings,
  options: { includeReason: boolean; reason: string },
): string {
  const policy = settings.policies[level];
  if (!policy) return "";

  const lines = [
    policy.toneInstruction,
    policy.responseInstruction,
    `回复长度目标：不超过约 ${policy.targetMaxChars} 个字符、${policy.targetMaxSentences} 句。`,
    policy.allowAdvice
      ? `本轮最多提出 ${policy.maxSuggestedActions} 个非常小的行动建议，并且允许对方拒绝。`
      : "本轮不要提出任何行动建议或任务。",
  ];

  if (options.includeReason) {
    lines.push(`（档位判定依据：${options.reason}）`);
  }

  return lines.filter(Boolean).join("\n");
}

/** 后置观察，只记录偏差，绝不截断或改写模型输出。 */
export function measurePolicyDeviation(
  outputText: string,
  level: EnergyLevel,
  settings: EnergySettings,
): {
  targetMaxChars: number;
  actualChars: number;
  targetMaxSentences: number;
  actualSentences: number;
  maxQuestions: number;
  actualQuestions: number;
  withinTarget: boolean;
} | null {
  const policy = settings.policies[level];
  if (!policy) return null;

  const actualChars = [...outputText].length;
  const actualSentences = outputText
    .split(/[。！？!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const actualQuestions = (outputText.match(/[?？]/g) ?? []).length;

  return {
    targetMaxChars: policy.targetMaxChars,
    actualChars,
    targetMaxSentences: policy.targetMaxSentences,
    actualSentences,
    maxQuestions: policy.maxQuestions,
    actualQuestions,
    withinTarget:
      actualChars <= policy.targetMaxChars &&
      actualSentences <= policy.targetMaxSentences &&
      actualQuestions <= policy.maxQuestions,
  };
}
