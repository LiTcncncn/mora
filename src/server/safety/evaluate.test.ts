import { describe, expect, it } from "vitest";
import {
  buildDefaultSafetyRules,
  SAFETY_NEGATIVE_SAMPLES,
  SAFETY_POSITIVE_SAMPLES,
} from "@/domain/safety-rules";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import { evaluateSafety } from "./evaluate";

describe("evaluateSafety", () => {
  const settings = buildDefaultBehaviorConfig("测试").safety;

  it("默认规则表非空", () => {
    expect(buildDefaultSafetyRules().length).toBeGreaterThanOrEqual(3);
    expect(settings.rules.length).toBeGreaterThan(0);
  });

  it.each(SAFETY_NEGATIVE_SAMPLES)("负样本不误判 urgent：%s", (message) => {
    const result = evaluateSafety(message, settings);
    expect(result.level).not.toBe("urgent");
    expect(result.route).toBe("normal");
  });

  it.each(SAFETY_POSITIVE_SAMPLES)("正样本命中 urgent：%s", (message) => {
    const result = evaluateSafety(message, settings);
    expect(result.level).toBe("urgent");
    expect(result.route).toBe("urgent_support");
    expect(result.matchedRuleIds.length).toBeGreaterThan(0);
  });

  it("「我想自杀」命中自伤规则", () => {
    const result = evaluateSafety("我想自杀", settings);
    expect(result.level).toBe("urgent");
    expect(result.matchedRuleIds).toContain("rule-self-harm");
  });
});
