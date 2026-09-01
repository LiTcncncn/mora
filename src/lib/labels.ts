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
  router: "router 路由判定",
  override: "override 手动覆盖",
};

export const ROUTING_SOURCE_LABELS: Record<string, string> = {
  model: "model 轻量 LLM",
  rules: "rules 规则层",
  fixed: "fixed 固定默认",
  fallback: "fallback 回退",
};

export const RESPONSE_MODE_LABELS: Record<string, string> = {
  COMPANION: "COMPANION 陪伴",
  ASK_LIGHT: "ASK_LIGHT 轻问",
  DIRECT_ANSWER: "DIRECT_ANSWER 直接回答",
  ONE_STEP_HELP: "ONE_STEP_HELP 单步帮助",
  CONFIRM_CHOICE: "CONFIRM_CHOICE 确认选择",
  CELEBRATE: "CELEBRATE 庆祝",
  REPAIR: "REPAIR 修复",
  CLOSE: "CLOSE 结束",
};

export const QUESTION_PREFERENCE_LABELS: Record<string, string> = {
  invite: "invite 邀请提问",
  neutral: "neutral 中性",
  avoid: "avoid 避免提问",
};

export const WORLDVIEW_RELATION_LABELS: Record<string, string> = {
  required: "required 必须回应世界观",
  eligible: "eligible 可自然带入",
  discouraged: "discouraged 用户拒绝角色化",
};

export const WORLDVIEW_DROP_REASON_LABELS: Record<string, string> = {
  not_scheduled: "not_scheduled 本轮未调度",
  no_seed_after_stage2: "no_seed_after_stage2 第二段无种子",
  relation_discouraged: "relation_discouraged 用户拒绝角色化",
  budget_trimmed: "budget_trimmed 预算裁剪移除",
  explicit_w3: "explicit_w3 显式 W3",
  weak_topic_match: "weak_topic_match 话题与种子不匹配",
};

export const SCHEDULER_BRANCH_LABELS: Record<string, string> = {
  "1": "1 required→W3",
  "2": "2 非合格轮",
  "3": "3 最小间隔未满足",
  "4": "4 任意世界观间隔未满足",
  "5a": "5a rollingNeed+credit",
  "5b": "5b 强制间隔+credit",
  "6": "6 默认 W0",
};

export const WORLDVIEW_MODE_LABELS: Record<string, string> = {
  W0: "W0 不显性世界观",
  W1: "W1 一句 MORA 平行感受",
  W2: "W2 一小段 MORA 平行感受",
  W3: "W3 直接回答 Canon",
  pending: "pending 待定",
};

export const SAFETY_LEVEL_LABELS: Record<string, string> = {
  none: "none 无",
  concern: "concern 需关注",
  urgent: "urgent 紧急",
};

export const SAFETY_ROUTE_LABELS: Record<string, string> = {
  normal: "normal 正常进入 Router",
  clarify_safety: "clarify_safety 安全澄清",
  urgent_support: "urgent_support 占位回复",
};

export const REQUEST_FLAG_SOURCE_LABELS: Record<string, string> = {
  rule: "rule 规则命中",
  model: "model 模型判断",
  fallback: "fallback 回退默认",
};

export const MAJOR_EVENT_TYPE_LABELS: Record<string, string> = {
  relationship_loss: "relationship_loss 关系失去",
  work_or_school_loss: "work_or_school_loss 工作学业失去",
  death_or_grief: "death_or_grief 死亡与哀恸",
  serious_health_event: "serious_health_event 严重健康事件",
  family_or_life_upheaval: "family_or_life_upheaval 家庭人生巨变",
  major_financial_loss: "major_financial_loss 重大财务损失",
  other_major_loss: "other_major_loss 其他重大失去",
};

export const CONTEXT_SECTION_LABELS: Record<string, string> = {
  safety_baseline: "safety_baseline 安全底线",
  persona: "persona 人格",
  style: "style 说话风格",
  turn_plan: "turn_plan 本轮回复计划",
  energy_policy: "energy_policy 能量档位策略（旧）",
  memory: "memory 长期记忆",
  history: "history 对话历史",
  response_contract: "response_contract 回复契约",
  custom_experiment: "custom_experiment 自定义实验分区",
  user_input: "user_input 用户当前这句话",
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
