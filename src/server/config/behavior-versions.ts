import "server-only";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import { canonicalStringify } from "./behavior-hash";

/**
 * §13.6.4：五个 version 字段的推进规则。
 *
 * 格式是单调递增整数的字符串，不用语义化版本——语义化版本需要人判断
 * 「这算 major 还是 minor」，而这里唯一的用途是判断新旧。
 *
 * 保存时由系统自增，不可手填；一次保存同时改动多个范围时各自独立自增。
 */

export const CONFIG_VERSION_FIELDS = [
  "taxonomyVersion",
  "energyPolicyVersion",
  "strategyPolicyVersion",
  "worldviewVersion",
  "exampleLibraryVersion",
] as const;

export type ConfigVersionField = (typeof CONFIG_VERSION_FIELDS)[number];

/**
 * 每个 version 字段覆盖的配置范围。
 *
 * `taxonomyVersion` 不在此表内：它覆盖的是枚举本身，只能随代码发布，
 * 无法通过比较两份配置的内容推断出来。
 */
const VERSION_SCOPES: Record<
  Exclude<ConfigVersionField, "taxonomyVersion">,
  ReadonlyArray<keyof BehaviorConfigV2>
> = {
  energyPolicyVersion: ["energy"],
  strategyPolicyVersion: ["strategies"],
  worldviewVersion: ["worldview", "canonFacts", "worldviewSeeds"],
  exampleLibraryVersion: ["exampleRetrieval", "exampleCards"],
};

function parseVersion(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  // 格式已由 configVersionStringSchema 保证，这里只防御手工改坏的存量数据。
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function nextVersion(current: string): string {
  return String(parseVersion(current) + 1);
}

export function compareVersions(a: string, b: string): number {
  return parseVersion(a) - parseVersion(b);
}

/**
 * 比较两份配置，返回需要自增的 version 字段。
 *
 * 用 canonical 序列化比较而不是逐字段深比较：canonical 已经处理了键序，
 * 而键序变化不该算成内容变化。
 */
export function changedVersionScopes(
  previous: BehaviorConfigV2,
  next: BehaviorConfigV2,
): ConfigVersionField[] {
  const changed: ConfigVersionField[] = [];

  for (const [field, scopes] of Object.entries(VERSION_SCOPES) as Array<
    [Exclude<ConfigVersionField, "taxonomyVersion">, ReadonlyArray<keyof BehaviorConfigV2>]
  >) {
    const before = canonicalStringify(scopes.map((key) => previous[key]));
    const after = canonicalStringify(scopes.map((key) => next[key]));
    if (before !== after) changed.push(field);
  }

  return changed;
}

/**
 * 保存路径：把改动过的范围各自自增一次。
 *
 * `taxonomyVersion` 原样保留——它随代码发布，保存用户的数值修改时不该动它。
 */
export function bumpChangedVersions(
  previous: BehaviorConfigV2,
  next: BehaviorConfigV2,
): { config: BehaviorConfigV2; bumped: ConfigVersionField[] } {
  const bumped = changedVersionScopes(previous, next);
  const config = { ...next };

  for (const field of bumped) {
    config[field] = nextVersion(previous[field]);
  }
  for (const field of CONFIG_VERSION_FIELDS) {
    if (!bumped.includes(field)) config[field] = previous[field];
  }

  return { config, bumped };
}

export interface VersionDowngrade {
  field: ConfigVersionField;
  from: string;
  to: string;
}

/**
 * 导入路径：检出降级。
 *
 * 降级是合法操作（回滚场景，D47），不拒绝，但必须在预览中显著标出并列出
 * 具体字段。导入后各 version 取「导入值」而不是 max——导入的语义是替换而非
 * 合并，取 max 会造出一个既不是旧配置也不是新配置的版本号。
 */
export function detectVersionDowngrades(
  current: Pick<BehaviorConfigV2, ConfigVersionField>,
  incoming: Pick<BehaviorConfigV2, ConfigVersionField>,
): VersionDowngrade[] {
  return CONFIG_VERSION_FIELDS.filter(
    (field) => compareVersions(incoming[field], current[field]) < 0,
  ).map((field) => ({
    field,
    from: current[field],
    to: incoming[field],
  }));
}
