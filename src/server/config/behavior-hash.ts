import "server-only";
import { createHash } from "node:crypto";
import {
  extractHashable,
  type BehaviorConfigHashable,
} from "@/domain/behavior-config";

/**
 * §13.6.3：configHash 的计算。
 *
 * 覆盖范围是参数九组加三类内容资产，**不含**信封字段、`configHash` 自身与
 * 五个 version 字符串。
 *
 * 覆盖三类资产的理由：§9.5.5 要求把当轮 configHash 写入 Run 用于解释行为突变。
 * 若 hash 不含种子库，策划改一颗种子的 attitude 后 hash 不变而行为已变，
 * 这个用途就失效——而这正是 §1 列为当前痛点的那类漂移。
 *
 * 排除 `exportedAt` 的理由：同一份配置连续导出两次必须得到相同 hash，
 * 否则无法用 hash 判断两份文件是否等价。
 *
 * 排除五个 version 的理由：它们随内容变化而递增，纳入 hash 会形成循环
 * （改内容 → 版本变 → hash 变 → 但 hash 本应只反映内容）。
 */

export const CONFIG_HASH_LENGTH = 16;

/**
 * 对象键按字典序递归排序后序列化。
 *
 * 数组**保持原有顺序**，不排序——种子顺序不影响行为，但排序会掩盖
 * 「顺序被意外改动」这类问题。
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      // undefined 在 JSON.stringify 里会被丢弃，先剔除避免键序里留下空洞。
      if (source[key] === undefined) continue;
      result[key] = canonicalize(source[key]);
    }
    return result;
  }

  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 取前 16 个十六进制字符。 */
export function computeConfigHash(config: BehaviorConfigHashable): string {
  const payload = canonicalStringify(extractHashable(config));
  return createHash("sha256")
    .update(payload, "utf8")
    .digest("hex")
    .slice(0, CONFIG_HASH_LENGTH);
}
