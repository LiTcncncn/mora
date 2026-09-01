import type { RequestFlagSettings } from "@/domain/behavior-config";
import type { ResolvedRequestFlags } from "@/domain/turn-routing";

function includesAny(text: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword)) return keyword;
  }
  return null;
}

/** §7.9：规则层 requestFlags，命中显式措辞时 source=rule。 */
export function resolveRequestFlagsByRules(
  text: string,
  settings: RequestFlagSettings,
): ResolvedRequestFlags {
  const evidence: string[] = [];
  let wantsDetailedAnswer = false;

  if (settings.detailedAnswerEnabled) {
    const hit = includesAny(text, settings.detailedAnswerKeywords);
    if (hit) {
      wantsDetailedAnswer = true;
      evidence.push(hit);
    }
  }

  return {
    wantsDetailedAnswer,
    wantsMultiStepPlan: false,
    source: "rule",
    evidence,
  };
}

/**
 * §7.9：规则优先；规则未命中时采用模型判断。
 * multiStepPlan 第一版只记录不生效。
 */
export function mergeRequestFlags(
  rules: ResolvedRequestFlags,
  model: Pick<ResolvedRequestFlags, "wantsDetailedAnswer" | "wantsMultiStepPlan" | "evidence">,
): ResolvedRequestFlags {
  if (rules.wantsDetailedAnswer) {
    return rules;
  }
  if (model.wantsDetailedAnswer) {
    return {
      wantsDetailedAnswer: true,
      wantsMultiStepPlan: false,
      source: "model",
      evidence: model.evidence,
    };
  }
  return {
    wantsDetailedAnswer: false,
    wantsMultiStepPlan: false,
    source: "model",
    evidence: model.evidence,
  };
}
