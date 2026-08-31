/**
 * 界面文案统一在英文术语后附中文解释，方便测试人员对照。
 * 模型名与版本号保持原样，不做翻译。
 */

export const ENERGY_LEVEL_LABELS: Record<string, string> = {
  E0: "E0 几乎没电",
  E1: "E1 低电量",
  E2: "E2 一般",
  E3: "E3 有余力",
};

export const ENERGY_MODE_LABELS: Record<string, string> = {
  manual: "manual 固定档位",
  rule_based: "rule_based 规则判定",
  hybrid: "hybrid 规则判定（可本轮手动覆盖）",
  llm: "llm 模型判定（规则仅作草稿）",
};

export const ENERGY_SOURCE_LABELS: Record<string, string> = {
  manual: "manual 固定档位",
  rule_based: "rule_based 规则判定",
  llm: "llm 模型判定",
};

export const FEW_SHOT_WORLDVIEW_LABELS: Record<string, string> = {
  none: "none 不带世界观",
  L1: "L1 非人类体感",
  L2: "L2 雨林联想",
};

export const FEW_SHOT_ENERGY_SCOPE_LABELS: Record<string, string> = {
  any: "any 任何档位",
  E0: "E0 几乎没电",
  E1: "E1 低电量",
  E2: "E2 一般",
  E3: "E3 有余力",
};

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  profile: "profile 基本情况",
  preference: "preference 偏好",
  event: "event 事件",
  support_strategy: "support_strategy 有效的陪伴方式",
  boundary: "boundary 边界",
  relationship: "relationship 关系",
  other: "other 其他",
};

export const MEMORY_SOURCE_LABELS: Record<string, string> = {
  manual: "manual 手动创建",
  conversation_candidate: "conversation_candidate 对话中提取",
};

export const MEMORY_WEIGHT_LABELS: Record<string, string> = {
  pinned: "pinned 置顶",
  importance: "importance 重要度",
  recency: "recency 新近度",
  keywordRelevance: "keywordRelevance 关键词相关",
};

export const PERSONA_TRAIT_LABELS: Record<string, string> = {
  warmth: "warmth 温度",
  humor: "humor 幽默",
  initiative: "initiative 主动性",
  directness: "directness 直接程度",
  playfulness: "playfulness 俏皮",
};

export const REPLY_LENGTH_LABELS: Record<string, string> = {
  very_short: "very_short 极短",
  short: "short 短",
  medium: "medium 中等",
  long: "long 长",
};

export const EMOJI_MODE_LABELS: Record<string, string> = {
  none: "none 不使用",
  rare: "rare 极少",
  light: "light 少量",
};

export const QUESTION_FREQUENCY_LABELS: Record<string, string> = {
  low: "low 低",
  medium: "medium 中",
  high: "high 高",
};

export const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "none 不推理",
  minimal: "minimal 极低",
  low: "low 低",
  medium: "medium 中",
  high: "high 高",
  xhigh: "xhigh 很高",
  max: "max 最高",
};

export const THINKING_MODE_LABELS: Record<string, string> = {
  enabled: "enabled 开启",
  disabled: "disabled 关闭",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  pending: "pending 进行中",
  succeeded: "succeeded 成功",
  failed: "failed 调用失败",
};

export const PARAMETER_STATUS_LABELS: Record<string, string> = {
  applied: "applied 已生效",
  not_applied: "not_applied 未生效",
  transformed: "transformed 已转换",
};

/** 供应商名属于品牌名，不翻译。 */
export const PROVIDER_LABELS: Record<string, string> = {
  kimi: "Kimi",
  deepseek: "DeepSeek",
  openai: "OpenAI",
};

export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
