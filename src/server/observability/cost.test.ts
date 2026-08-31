import { describe, expect, it } from "vitest";
import type { TokenUsage } from "@/domain/common";
import { estimateCost } from "./cost";

const usage: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  totalTokens: 2_000_000,
  cachedInputTokens: 0,
  source: "provider",
};

const pricing = {
  currency: "USD" as const,
  inputPerMillion: 1,
  cachedInputPerMillion: 0.5,
  outputPerMillion: 2,
  label: "示例价格",
  effectiveDate: "2026-08-21",
};

describe("estimateCost", () => {
  it("按百万 token 单价计算并始终标记为估算", () => {
    const result = estimateCost(usage, pricing);
    expect(result.amount).toBe(3);
    expect(result.isEstimate).toBe(true);
  });

  it("价格未配置时返回 null，而不是 0", () => {
    const result = estimateCost(usage, {
      ...pricing,
      inputPerMillion: null,
      outputPerMillion: null,
      cachedInputPerMillion: null,
    });
    expect(result.amount).toBeNull();
  });

  it("usage 不可用时返回 null", () => {
    const result = estimateCost(
      {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        source: "unavailable",
      },
      pricing,
    );
    expect(result.amount).toBeNull();
  });

  it("缓存输入按缓存价计费", () => {
    const result = estimateCost(
      { ...usage, cachedInputTokens: 1_000_000, outputTokens: 0 },
      pricing,
    );
    expect(result.amount).toBe(0.5);
  });
});
