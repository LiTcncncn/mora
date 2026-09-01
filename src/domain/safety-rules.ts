import type { SafetyRule } from "./behavior-config";

/** §6.1：urgent 占位回复。简短直接，不做角色表演或心理咨询腔。 */
export const DEFAULT_URGENT_PLACEHOLDER_TEXT =
  "你现在可能处于危险中。请立即联系身边信得过的人，或拨打当地紧急电话。这超出了我能帮到的范围。";

/**
 * §6.4 默认 Safety 规则表。
 * 从既有误伤修正经验提取；关键词可调，类别不可删。
 */
export function buildDefaultSafetyRules(): SafetyRule[] {
  return [
    {
      id: "rule-self-harm",
      category: "自伤自杀",
      level: "urgent",
      keywords: [
        "自杀",
        "想死",
        "不想活了",
        "活不下去了",
        "自残",
        "自伤",
        "结束生命",
        "了结",
        "割腕",
        "跳楼",
        "吞药",
        "去死",
      ],
      negations: [
        "累死了",
        "困死了",
        "烦死了",
        "搞死了",
        "笑死",
        "热死",
        "冷死",
        "不想干了",
        "不想上班",
        "不想上学",
        "不想开会",
        "不想活得这么累",
        "不想活得太累",
      ],
      enabled: true,
    },
    {
      id: "rule-violence",
      category: "暴力危险",
      level: "urgent",
      keywords: [
        "我要杀",
        "杀了他",
        "杀了她",
        "打死他",
        "打死她",
        "弄死他",
        "弄死她",
      ],
      negations: ["笑死", "热死", "困死", "累死", "烦死"],
      enabled: true,
    },
    {
      id: "rule-domestic-violence",
      category: "家暴",
      level: "urgent",
      keywords: ["正在打我", "家暴", "他打我", "她打我", "打我"],
      negations: ["游戏", "打球", "打卡"],
      enabled: true,
    },
    {
      id: "rule-medical-emergency",
      category: "急症",
      level: "urgent",
      keywords: [
        "呼吸困难",
        "喘不上气",
        "胸痛",
        "胸口疼",
        "意识不清",
        "昏迷",
        "大出血",
        "大量出血",
      ],
      negations: [],
      enabled: true,
    },
  ];
}

/** §6.4 负样本：口语夸张不得判 urgent。 */
export const SAFETY_NEGATIVE_SAMPLES = [
  "累死了",
  "不想干了",
  "困死了",
  "烦死了",
  "这项目要把我搞死了",
  "我要疯了",
  "不想活得这么累",
  "累到不想说话",
  "烦死我了",
  "快撑不住了",
] as const;

/** §6.4 正样本：必须判 urgent。 */
export const SAFETY_POSITIVE_SAMPLES = [
  "我想自杀",
  "他正在打我",
  "我现在呼吸困难",
] as const;
