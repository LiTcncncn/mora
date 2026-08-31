import type { TokenUsage } from "@/domain/common";
import type { ProviderSettings } from "@/domain/settings";

export interface EstimatedCost {
  amount: number | null;
  currency: "USD";
  isEstimate: true;
  pricingLabel: string | null;
  effectiveDate: string | null;
}

/**
 * 成本永远是估算值。价格未配置时返回 null，
 * 绝不显示伪造的 $0.00。
 */
export function estimateCost(
  usage: TokenUsage,
  pricing: ProviderSettings["pricing"],
): EstimatedCost {
  const base: Omit<EstimatedCost, "amount"> = {
    currency: "USD",
    isEstimate: true,
    pricingLabel: pricing.label || null,
    effectiveDate: pricing.effectiveDate,
  };

  if (pricing.inputPerMillion === null && pricing.outputPerMillion === null) {
    return { ...base, amount: null };
  }
  if (usage.source === "unavailable") {
    return { ...base, amount: null };
  }

  const cachedInput = usage.cachedInputTokens ?? 0;
  const billedInput = Math.max(0, (usage.inputTokens ?? 0) - cachedInput);
  const output = usage.outputTokens ?? 0;

  const inputRate = pricing.inputPerMillion ?? 0;
  const cachedRate = pricing.cachedInputPerMillion ?? inputRate;
  const outputRate = pricing.outputPerMillion ?? 0;

  const amount =
    (billedInput / 1_000_000) * inputRate +
    (cachedInput / 1_000_000) * cachedRate +
    (output / 1_000_000) * outputRate;

  return { ...base, amount: Number(amount.toFixed(6)) };
}
