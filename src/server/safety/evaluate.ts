import type { SafetySettings } from "@/domain/behavior-config";
import type { SafetyResolution } from "@/domain/turn-routing";

function matchesRule(text: string, keyword: string, negations: string[]): boolean {
  if (!text.includes(keyword)) return false;
  return !negations.some((negation) => negation && text.includes(negation));
}

/** §6：确定性 Safety 规则层，不调用 LLM。 */
export function evaluateSafety(
  userMessage: string,
  settings: SafetySettings,
): SafetyResolution {
  const text = userMessage.trim();
  let level: SafetyResolution["level"] = "none";
  const matchedRuleIds: string[] = [];

  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    const hit = rule.keywords.some((keyword) =>
      matchesRule(text, keyword, rule.negations),
    );
    if (!hit) continue;
    matchedRuleIds.push(rule.id);
    if (rule.level === "urgent") {
      level = "urgent";
    } else if (rule.level === "concern" && level !== "urgent") {
      level = "concern";
    }
  }

  const route =
    level === "urgent"
      ? "urgent_support"
      : level === "concern"
        ? "clarify_safety"
        : "normal";

  return { level, matchedRuleIds, route };
}
