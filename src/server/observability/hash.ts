import { createHash } from "node:crypto";

/** 稳定序列化：对象键排序，保证同样内容得到同样 hash。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

/** 粗略 token 估算，仅用于 Inspector 显示，绝不冒充 provider usage。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}
