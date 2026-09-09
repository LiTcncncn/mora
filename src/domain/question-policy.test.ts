import { describe, expect, it } from "vitest";
import {
  formatNeutralMustAskPercent,
  normalizeQuestionPolicyForSave,
  parseNeutralMustAskPercent,
} from "./question-policy";

describe("parseNeutralMustAskPercent", () => {
  it("解析整数百分比", () => {
    expect(parseNeutralMustAskPercent("70")).toBe(0.7);
    expect(parseNeutralMustAskPercent("0")).toBe(0);
    expect(parseNeutralMustAskPercent("100")).toBe(1);
  });

  it("越界 clamp", () => {
    expect(parseNeutralMustAskPercent("150")).toBe(1);
    expect(parseNeutralMustAskPercent("-5")).toBe(0);
  });

  it("非法输入回退默认", () => {
    expect(parseNeutralMustAskPercent("", 50)).toBe(0.5);
    expect(parseNeutralMustAskPercent("abc", 30)).toBe(0.3);
  });
});

describe("normalizeQuestionPolicyForSave", () => {
  it("probabilistic 时规范化为两位小数的百分比", () => {
    expect(
      normalizeQuestionPolicyForSave({
        neutralMode: "probabilistic",
        neutralMustAskProbability: 0.7000000001,
        suppressIfLastAssistantAsked: true,
      }).neutralMustAskProbability,
    ).toBe(0.7);
  });

  it("非 probabilistic 不改动概率字段", () => {
    expect(
      normalizeQuestionPolicyForSave({
        neutralMode: "never",
        neutralMustAskProbability: 0.9,
        suppressIfLastAssistantAsked: false,
      }),
    ).toEqual({
      neutralMode: "never",
      neutralMustAskProbability: 0.9,
      suppressIfLastAssistantAsked: false,
    });
  });
});

describe("formatNeutralMustAskPercent", () => {
  it("格式化为整数百分比字符串", () => {
    expect(formatNeutralMustAskPercent(0.5)).toBe("50");
    expect(formatNeutralMustAskPercent(0.7)).toBe("70");
  });
});
