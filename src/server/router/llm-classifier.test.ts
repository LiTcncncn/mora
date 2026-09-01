import { describe, expect, it } from "vitest";
import { parseLlmRouterOutput, RouterParseError } from "./llm-classifier";

const VALID = JSON.stringify({
  energy: { level: "E2", confidence: 0.7, evidence: ["还行"] },
  majorEvent: {
    matched: false,
    type: null,
    temporalStatus: null,
    subject: null,
    evidence: [],
  },
  questionPreference: { value: "neutral", confidence: 0.6, evidence: [] },
  responseMode: { value: "DIRECT_ANSWER", confidence: 0.8, evidence: ["为什么"] },
  worldviewRelation: {
    level: "required",
    tags: [],
    referencedEntities: [],
    confidence: 0.9,
    evidence: ["亚马逊"],
  },
  requestFlags: {
    wantsDetailedAnswer: true,
    wantsMultiStepPlan: false,
    evidence: ["详细说说"],
  },
  overallConfidence: 0.75,
});

describe("parseLlmRouterOutput", () => {
  it("解析合法 JSON", () => {
    const parsed = parseLlmRouterOutput(VALID);
    expect(parsed.responseMode.value).toBe("DIRECT_ANSWER");
    expect(parsed.worldviewRelation.level).toBe("required");
  });

  it("拒绝额外字段", () => {
    const payload = JSON.parse(VALID) as Record<string, unknown>;
    payload.extra = true;
    expect(() => parseLlmRouterOutput(JSON.stringify(payload))).toThrow(
      RouterParseError,
    );
  });

  it("拒绝非法 responseMode", () => {
    const payload = JSON.parse(VALID) as Record<string, unknown>;
    (payload.responseMode as { value: string }).value = "INVALID";
    expect(() => parseLlmRouterOutput(JSON.stringify(payload))).toThrow(
      RouterParseError,
    );
  });
});
