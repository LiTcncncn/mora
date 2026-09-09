import { z } from "zod";
import {
  behaviorExampleCardSchema,
  buildDefaultExampleRetrievalSettings,
  exampleRetrievalSettingsSchema,
} from "./behavior-example";
import { personaSchema } from "./persona";
import { promptPresetSchema } from "./prompt";
import { settingsDataSchema } from "./settings";
import {
  buildDefaultSafetyRules,
  DEFAULT_URGENT_PLACEHOLDER_TEXT,
} from "./safety-rules";
import { safetyLevelSchema } from "./behavior-taxonomy";
import { energyLevelSchema, idSchema, providerIdSchema } from "./common";
import {
  buildDefaultStrategyPolicies,
  strategyPoliciesSchema,
} from "./strategy-policy";
import {
  buildDefaultWorldviewSettings,
  worldviewCanonFactSchema,
  worldviewSeedSchema,
  worldviewSettingsSchema,
} from "./worldview-v2";
import {
  buildDefaultQuestionPolicy,
  questionPolicySettingsSchema,
} from "./question-policy";

/**
 * §13：Behavior Config v2。行为规则的唯一事实源。
 *
 * v1 的问题是同一个数字散落在 Persona 文本、Energy Policy、few-shot note 与
 * 说明 md 四处，改一处另外三处不动（§1）。v2 的所有分组都从这一个结构读。
 *
 * 结构上分四段：信封、五个 version、参数、内容资产。
 * 三类内容资产在顶层有位置是 D57 的核心——策划的主要工作产物此前在顶层
 * 没有字段，导致「配置」到底包不包含它们始终没有答案。
 */

export const BEHAVIOR_CONFIG_SCHEMA_VERSION = 2 as const;

/** §13.6.1：三种导出粒度靠 kind 区分。导入器先读 kind 再决定路径。 */
export const behaviorConfigKindSchema = z.literal("mora_behavior_config");
export const worldviewLibraryKindSchema = z.literal("mora_worldview_library");
export const exampleLibraryKindSchema = z.literal("mora_example_library");

// ------------------------------------------------------------ 参数分组

/** §3.1：品牌与世界观的统一表述，供 canon lint 与 Persona 渲染引用。 */
export const brandCanonSettingsSchema = z.object({
  /** 「南美亚马逊热带雨林」这一层，不落到专名（§3.2）。 */
  originStatement: z.string().min(1).max(200),
  /** 「通过远方朋友计划借住」。Persona 只保留这两层。 */
  arrivalStatement: z.string().min(1).max(200),
  /** §3.3：新写内容只允许使用白名单内的亚马逊物种。 */
  approvedSpecies: z.array(z.string().min(1).max(40)).max(200),
  /** 白名单外的物种不拒绝，但进入待审核（D31）。 */
  unlistedSpeciesRequiresReview: z.literal(true),
}).strict();
export type BrandCanonSettings = z.infer<typeof brandCanonSettingsSchema>;

/** §13.1：Turn Router。 */
export const turnRouterSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["llm", "rules", "fixed"]),
  provider: providerIdSchema,
  modelId: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().positive().max(8000),
  recentMessageCount: z.number().int().min(0).max(50),
  maxContextChars: z.number().int().min(0).max(50_000),
  minOverallConfidence: z.number().min(0).max(1),
  allowPerMessageOverride: z.boolean(),
  /** 单次调用超时，默认 15000，本版取宽（D12）。 */
  timeoutMs: z.number().int().min(1000).max(120_000),
  /** 最多一次重试，固定 1（§13.5 只读）。 */
  maxRetries: z.literal(1),
}).strict();
export type TurnRouterSettings = z.infer<typeof turnRouterSettingsSchema>;

/**
 * §13.1.1：请求标志设置（D55）。
 * 四项全部只读、随代码发布，但纳入 configHash——改动会直接改变篇幅与动作数。
 */
export const requestFlagSettingsSchema = z.object({
  detailedAnswerKeywords: z.array(z.string().min(1).max(40)).max(200),
  multiStepPlanKeywords: z.array(z.string().min(1).max(40)).max(200),
  detailedAnswerEnabled: z.boolean(),
  /** 第一版固定 false，只记录不生效（§8.5）。 */
  multiStepPlanEnabled: z.literal(false),
}).strict();
export type RequestFlagSettings = z.infer<typeof requestFlagSettingsSchema>;

/** §4.3：单档能量预算。 */
export const energyBudgetSchema = z.object({
  label: z.string().min(1).max(20),
  targetMinChars: z.number().int().min(0).max(20_000),
  targetMaxChars: z.number().int().positive().max(20_000),
  hardMaxChars: z.number().int().positive().max(20_000),
  maxSentences: z.number().int().positive().max(200),
  defaultMaxActions: z.number().int().min(0).max(2),
  providerMaxOutputTokens: z.number().int().positive().max(200_000),
}).strict();
export type EnergyBudget = z.infer<typeof energyBudgetSchema>;

export const energyV2SettingsSchema = z.object({
  budgets: z.object({
    E0: energyBudgetSchema,
    E1: energyBudgetSchema,
    E2: energyBudgetSchema,
    E3: energyBudgetSchema,
  }),
  /** §4.3：超 hardMaxChars 未达 20% 时不截断，只标黄（D9）。 */
  hardMaxToleranceRatio: z.number().min(0).max(1),
}).strict();
export type EnergyV2Settings = z.infer<typeof energyV2SettingsSchema>;

/** §5：重大事件。类型枚举只读，只有阈值可调（§13.5）。 */
export const majorEventSettingsSchema = z.object({
  enabled: z.boolean(),
  /** §5.6：事件指纹再识别的相似度阈值。 */
  fingerprintSimilarityThreshold: z.number().min(0).max(1),
  /** lastSeenAt 超过这个月数的指纹在下次读取时清理（§5.6）。 */
  fingerprintRetentionMonths: z.number().int().min(1).max(120),
  /** §5.5：首轮回复的字数硬上限，优先于 requestFlags（§8.6）。 */
  firstMentionHardMaxChars: z.number().int().positive().max(2000),
  firstMentionMaxSentences: z.number().int().positive().max(20),
}).strict();
export type MajorEventSettings = z.infer<typeof majorEventSettingsSchema>;

/** §6：Safety 规则表。类别枚举与优先级只读，关键词与阈值可调（§13.5）。 */
export const safetyRuleSchema = z.object({
  id: idSchema,
  category: z.string().min(1).max(40),
  level: safetyLevelSchema,
  keywords: z.array(z.string().min(1).max(60)).max(200),
  /** 否定式排除：命中这些词时不算命中，用于压误伤（§6.4）。 */
  negations: z.array(z.string().min(1).max(60)).max(200),
  enabled: z.boolean(),
}).strict();
export type SafetyRule = z.infer<typeof safetyRuleSchema>;

export const safetySettingsSchema = z.object({
  /** §6.1：urgent 时返回占位回复，不进主模型。 */
  urgentPlaceholderEnabled: z.boolean(),
  urgentPlaceholderText: z.string().min(1).max(200),
  rules: z.array(safetyRuleSchema).max(500),
}).strict();
export type SafetySettings = z.infer<typeof safetySettingsSchema>;

/** §10.4：Response Contract 只保留输出格式约束，全部随代码发布。 */
export const responseContractSettingsSchema = z.object({
  forbidHeadings: z.literal(true),
  forbidBulletLists: z.literal(true),
  forbidInternalAnalysis: z.literal(true),
  forbidRoleLabels: z.literal(true),
  maxEmojiPerReply: z.number().int().min(0).max(5),
}).strict();
export type ResponseContractSettings = z.infer<
  typeof responseContractSettingsSchema
>;

// ------------------------------------------------------------ 顶层结构

/**
 * 五个 version 字段。格式是**单调递增整数的字符串**（§13.6.4）——
 * 不用语义化版本，因为唯一用途是判断新旧，而语义化版本需要人判断
 * 「这算 major 还是 minor」。
 */
export const configVersionStringSchema = z.string().regex(/^[1-9]\d*$/, {
  message: "version 必须是单调递增的正整数字符串",
});

const behaviorConfigBodyShape = {
  brandCanon: brandCanonSettingsSchema,
  router: turnRouterSettingsSchema,
  requestFlags: requestFlagSettingsSchema,
  questionPolicy: questionPolicySettingsSchema,
  energy: energyV2SettingsSchema,
  majorEvent: majorEventSettingsSchema,
  safety: safetySettingsSchema,
  strategies: strategyPoliciesSchema,
  worldview: worldviewSettingsSchema,
  exampleRetrieval: exampleRetrievalSettingsSchema,
  responseContract: responseContractSettingsSchema,

  // 内容资产（D57：随主配置一起导出，并纳入 configHash）
  canonFacts: z.array(worldviewCanonFactSchema).max(2000),
  worldviewSeeds: z.array(worldviewSeedSchema).max(2000),
  exampleCards: z.array(behaviorExampleCardSchema).max(2000),
} as const;

/**
 * hash 覆盖范围（§13.6.3）：参数九组加三类资产，不含信封与五个 version。
 * 单独导出这个 schema 是为了让 hash 计算与结构定义共用一处字段清单——
 * 两处各写一份，加字段时必然漏一处，而漏掉的那次 hash 就不再反映内容。
 */
export const behaviorConfigHashableSchema = z
  .object(behaviorConfigBodyShape)
  .strict();
export type BehaviorConfigHashable = z.infer<
  typeof behaviorConfigHashableSchema
>;

export const BEHAVIOR_CONFIG_HASHABLE_KEYS = Object.keys(
  behaviorConfigBodyShape,
).sort() as Array<keyof BehaviorConfigHashable>;

function stripRecordKey(
  record: Record<string, unknown> | undefined,
  key: string,
): void {
  if (record && key in record) delete record[key];
}

function migrateQuestionPolicy(raw: Record<string, unknown>): void {
  if (!raw.questionPolicy || typeof raw.questionPolicy !== "object") {
    raw.questionPolicy = buildDefaultQuestionPolicy();
    return;
  }

  const policy = raw.questionPolicy as Record<string, unknown>;

  if ("neutralPermission" in policy && !("neutralMode" in policy)) {
    const permission = policy.neutralPermission;
    if (permission === "never") {
      policy.neutralMode = "never";
    } else {
      policy.neutralMode = "probabilistic";
      policy.neutralMustAskProbability = 0.5;
    }
    delete policy.neutralPermission;
  }

  if (typeof policy.neutralMustAskProbability !== "number") {
    policy.neutralMustAskProbability = 0.5;
  }
}

/** 读取旧配置时剥离已废弃的提问字段，并补齐 questionPolicy。 */
export function normalizeLegacyBehaviorConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clone = structuredClone(raw) as Record<string, unknown>;

  migrateQuestionPolicy(clone);

  const strategies = clone.strategies;
  if (strategies && typeof strategies === "object") {
    for (const policy of Object.values(
      strategies as Record<string, Record<string, unknown>>,
    )) {
      stripRecordKey(policy, "defaultMaxQuestions");
      stripRecordKey(policy, "allowInviteOverride");
    }
  }

  const energy = clone.energy;
  if (energy && typeof energy === "object") {
    const budgets = (energy as Record<string, unknown>).budgets;
    if (budgets && typeof budgets === "object") {
      for (const budget of Object.values(
        budgets as Record<string, Record<string, unknown>>,
      )) {
        stripRecordKey(budget, "defaultMaxQuestions");
      }
    }
  }

  return clone;
}

const behaviorConfigV2BodySchema = z
  .object({
    schemaVersion: z.literal(BEHAVIOR_CONFIG_SCHEMA_VERSION),
    kind: behaviorConfigKindSchema,
    sourceProfileName: z.string().min(1).max(120),

    taxonomyVersion: configVersionStringSchema,
    energyPolicyVersion: configVersionStringSchema,
    strategyPolicyVersion: configVersionStringSchema,
    worldviewVersion: configVersionStringSchema,
    exampleLibraryVersion: configVersionStringSchema,
    configHash: z.string().length(16),

    ...behaviorConfigBodyShape,
  })
  .strict();

/**
 * 活动配置：不含 `exportedAt`。该字段只在导出时写入（§13）。
 * 把它排除在活动配置之外，才能让「同一份配置连续导出两次得到相同 hash」
 * 这条要求在类型层面就成立。
 */
export const behaviorConfigV2Schema = z.preprocess(
  normalizeLegacyBehaviorConfig,
  behaviorConfigV2BodySchema,
);
export type BehaviorConfigV2 = z.infer<typeof behaviorConfigV2Schema>;

/** §13.6.7：完整导出时附带 Lab 运行时（Persona / Preset / Settings），不含 API Key。 */
export const labRuntimeExportSchema = z
  .object({
    settings: settingsDataSchema,
    personas: z.array(personaSchema),
    promptPresets: z.array(promptPresetSchema),
  })
  .strict();
export type LabRuntimeExport = z.infer<typeof labRuntimeExportSchema>;

/** 导出文件在活动配置之上多一个 `exportedAt`（§13.6.3 明确排除在 hash 外）。 */
const behaviorConfigExportBodySchema = behaviorConfigV2BodySchema
  .extend({
    exportedAt: z.string().datetime({ offset: true }),
    /** 完整导出时包含；单库与世界观库导出不含此字段。 */
    labRuntime: labRuntimeExportSchema.optional(),
  })
  .strict();

export const behaviorConfigExportSchema = z.preprocess(
  normalizeLegacyBehaviorConfig,
  behaviorConfigExportBodySchema,
);
export type BehaviorConfigExport = z.infer<typeof behaviorConfigExportSchema>;

/**
 * §13.6.1 单库文件。
 * 不含 configHash 与五个 version：它们是主配置的属性，单库导入后由接收端重算。
 */
export const worldviewLibraryExportSchema = z
  .object({
    schemaVersion: z.literal(BEHAVIOR_CONFIG_SCHEMA_VERSION),
    kind: worldviewLibraryKindSchema,
    exportedAt: z.string().datetime({ offset: true }),
    sourceProfileName: z.string().min(1).max(120),
    canonFacts: z.array(worldviewCanonFactSchema).max(2000),
    worldviewSeeds: z.array(worldviewSeedSchema).max(2000),
  })
  .strict();
export type WorldviewLibraryExport = z.infer<
  typeof worldviewLibraryExportSchema
>;

export const exampleLibraryExportSchema = z
  .object({
    schemaVersion: z.literal(BEHAVIOR_CONFIG_SCHEMA_VERSION),
    kind: exampleLibraryKindSchema,
    exportedAt: z.string().datetime({ offset: true }),
    sourceProfileName: z.string().min(1).max(120),
    exampleCards: z.array(behaviorExampleCardSchema).max(2000),
  })
  .strict();
export type ExampleLibraryExport = z.infer<typeof exampleLibraryExportSchema>;

/**
 * §13.6.2：v2 三种 kind 的判别。
 * 用 kind 而不是靠字段存在性猜测——猜测在两种 kind 字段重叠时会选错路径。
 */
export const anyV2ExportSchema = z.discriminatedUnion("kind", [
  behaviorConfigExportBodySchema,
  worldviewLibraryExportSchema,
  exampleLibraryExportSchema,
]);
export type AnyV2Export = z.infer<typeof anyV2ExportSchema>;

/** 存储信封：活动配置按 profile 存放。 */
export const behaviorConfigStoreItemSchema = z.object({
  profileId: idSchema,
  config: behaviorConfigV2Schema,
}).strict();

export const behaviorConfigStoreDataSchema = z.object({
  items: z.array(behaviorConfigStoreItemSchema),
}).strict();
export type BehaviorConfigStoreData = z.infer<
  typeof behaviorConfigStoreDataSchema
>;

// ------------------------------------------------------------ 默认值

/** §4.3：v1.1 初始能量数值（D8），随代码发布一次，之后在 Lab 内调整。 */
function buildDefaultEnergySettings(): EnergyV2Settings {
  return {
    budgets: {
      E0: {
        label: "崩溃",
        targetMinChars: 30,
        targetMaxChars: 100,
        hardMaxChars: 140,
        maxSentences: 3,
        defaultMaxActions: 0,
        providerMaxOutputTokens: 180,
      },
      E1: {
        label: "0 电量",
        targetMinChars: 40,
        targetMaxChars: 140,
        hardMaxChars: 180,
        maxSentences: 3,
        defaultMaxActions: 0,
        providerMaxOutputTokens: 260,
      },
      E2: {
        label: "低电量",
        targetMinChars: 80,
        targetMaxChars: 220,
        hardMaxChars: 300,
        maxSentences: 5,
        defaultMaxActions: 1,
        providerMaxOutputTokens: 460,
      },
      E3: {
        label: "中高电量",
        targetMinChars: 120,
        targetMaxChars: 420,
        hardMaxChars: 600,
        maxSentences: 8,
        defaultMaxActions: 2,
        providerMaxOutputTokens: 900,
      },
    },
    hardMaxToleranceRatio: 0.2,
  };
}

/**
 * §4.3 的换算基准，供 Lab 内联动重算 providerMaxOutputTokens：
 * `hardMaxChars × 0.7 × 1.5`，1.5 是标点、emoji 与分词波动的余量。
 */
export const CHARS_TO_TOKENS_RATIO = 0.7;
export const TOKEN_BUDGET_SLACK = 1.5;

export function suggestedProviderMaxOutputTokens(hardMaxChars: number): number {
  return Math.ceil(hardMaxChars * CHARS_TO_TOKENS_RATIO * TOKEN_BUDGET_SLACK);
}

/** §7.9：规则层关键词。只读常量，随代码发布。 */
function buildDefaultRequestFlagSettings(): RequestFlagSettings {
  return {
    detailedAnswerKeywords: [
      "详细说说",
      "详细讲",
      "说详细点",
      "具体分析",
      "帮我分析",
      "展开说",
      "说得再细",
      "完整讲一下",
    ],
    multiStepPlanKeywords: [
      "给个方案",
      "制定计划",
      "分几步",
      "步骤",
      "怎么一步步",
      "完整计划",
    ],
    detailedAnswerEnabled: true,
    multiStepPlanEnabled: false,
  };
}

export function buildDefaultBrandCanonSettings(): BrandCanonSettings {
  return {
    originStatement: "来自南美亚马逊热带雨林",
    arrivalStatement: "通过远方朋友计划借住",
    // §3.3 已批准的示例；白名单由策划继续扩充。
    approvedSpecies: [
      "树懒",
      "亚马逊陆龟",
      "闪蝶",
      "巨嘴鸟",
      "吼猴",
      "树蛙",
      "卷尾猴",
      "凤梨科植物",
      "绞杀榕",
      "王莲",
    ],
    unlistedSpeciesRequiresReview: true,
  };
}

/**
 * 全新档案的默认配置。
 *
 * `configHash` 留空字符串占位，由 `finalizeBehaviorConfig`（server 侧）算出后回填。
 * domain 层不引入 node:crypto，否则这个模块无法在客户端组件里被引用。
 */
export function buildDefaultBehaviorConfig(
  sourceProfileName: string,
): Omit<BehaviorConfigV2, "configHash"> {
  return {
    schemaVersion: BEHAVIOR_CONFIG_SCHEMA_VERSION,
    kind: "mora_behavior_config",
    sourceProfileName,

    taxonomyVersion: "1",
    energyPolicyVersion: "1",
    strategyPolicyVersion: "1",
    worldviewVersion: "1",
    exampleLibraryVersion: "1",

    brandCanon: buildDefaultBrandCanonSettings(),
    router: {
      enabled: true,
      mode: "llm",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      temperature: 0,
      maxOutputTokens: 400,
      recentMessageCount: 6,
      maxContextChars: 2000,
      minOverallConfidence: 0.5,
      allowPerMessageOverride: true,
      timeoutMs: 15_000,
      maxRetries: 1,
    },
    requestFlags: buildDefaultRequestFlagSettings(),
    questionPolicy: buildDefaultQuestionPolicy(),
    energy: buildDefaultEnergySettings(),
    majorEvent: {
      enabled: true,
      fingerprintSimilarityThreshold: 0.7,
      fingerprintRetentionMonths: 12,
      firstMentionHardMaxChars: 140,
      firstMentionMaxSentences: 3,
    },
    safety: {
      urgentPlaceholderEnabled: true,
      urgentPlaceholderText: DEFAULT_URGENT_PLACEHOLDER_TEXT,
      rules: buildDefaultSafetyRules(),
    },
    strategies: buildDefaultStrategyPolicies(),
    worldview: buildDefaultWorldviewSettings(),
    exampleRetrieval: buildDefaultExampleRetrievalSettings(),
    responseContract: {
      forbidHeadings: true,
      forbidBulletLists: true,
      forbidInternalAnalysis: true,
      forbidRoleLabels: true,
      maxEmojiPerReply: 1,
    },

    canonFacts: buildDefaultStarterCanonFacts(),
    worldviewSeeds: buildDefaultStarterWorldviewSeeds(),
    exampleCards: buildDefaultStarterExampleCards(),
  };
}

function buildDefaultStarterCanonFacts(): BehaviorConfigV2["canonFacts"] {
  return [
    {
      id: "fact-origin-tree",
      category: "origin",
      content: "ZHAKA 出生在亚马逊雨林深处的一棵树上，那里常年湿热，树冠层光线斑驳。",
      aliases: ["出生", "出生地", "你在哪出生", "从哪里来"],
      enabled: true,
      version: 1,
    },
    {
      id: "fact-friend-plan",
      category: "relationship",
      content: "ZHAKA 通过「远方朋友计划」借住在用户这里，像雨林里的寄居关系一样临时落脚。",
      aliases: ["朋友计划", "为什么在这", "怎么来的"],
      enabled: true,
      version: 1,
    },
    {
      id: "fact-friend-flash-butterfly",
      category: "relationship",
      content: "闪蝶是 ZHAKA 在雨林里的朋友之一，翅膀张开时很亮，常常说着说着就飞走了。",
      aliases: ["闪蝶", "蝴蝶朋友", "你的朋友"],
      enabled: true,
      version: 1,
    },
  ];
}

function buildDefaultStarterWorldviewSeeds(): BehaviorConfigV2["worldviewSeeds"] {
  return [
    {
      id: "seed-rain-001",
      title: "雨停之后",
      tags: ["rain", "累", "阴", "下雨", "雨天"],
      triggerDescription:
        "用户描述下雨、雨天、外面在下雨、连续阴雨、提不起劲、什么都不想做",
      memory:
        "雨季里有几天一直在滴水，我也会挂在枝条上哪也不去，等雨自己停——雨声很大时，反而不用决定下一步。",
      attitude:
        "不急着让雨停，也不催动起来。累的时候发会儿呆就行。",
      allowedResponseModes: ["COMPANION", "ASK_LIGHT"],
      energyFit: ["E1", "E2"],
      allowedModes: ["W1", "W2"],
      blockedMajorEventTypes: [],
      avoidClaims: ["不要编造具体地名或海岸场景", "不要用甘多卡等已废弃地名"],
      cooldownGroup: "rain",
      canonFactIds: ["fact-origin-tree"],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-grey-before-rain-002",
      title: "雨前暗下来",
      tags: ["阴天", "阴", "灰", "空落落", "抑郁", "低落", "下雨前"],
      triggerDescription:
        "用户说阴天、心里空落落的、抑郁、情绪低落、天气灰蒙蒙、觉得没颜色、提不起劲",
      memory:
        "大雨要来前，我也会觉得天色先暗一轮，连闪蝶都会忽然藏进叶缝里——那时候什么也不想决定，就陪着暗。",
      attitude:
        "不劝振作。承认心里空一块是合理的，就在这块灰灰的天气里陪着，不急着把人拉出来。",
      allowedResponseModes: ["COMPANION"],
      energyFit: ["E1", "E2", "E3"],
      allowedModes: ["W1", "W2"],
      blockedMajorEventTypes: [],
      avoidClaims: [
        "不要用甘多卡、海岸、沙滩等已废弃场景",
        "一轮最多提一个朋友或一个感官画面",
      ],
      cooldownGroup: "rain-grey",
      canonFactIds: ["fact-friend-flash-butterfly", "fact-origin-tree"],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-rain-pessimism-003",
      title: "连雨天也会悲观",
      tags: ["rain", "阴天", "悲观", "低落", "不见好转"],
      triggerDescription:
        "用户因阴天、连续低落、长期不见好转而悲观，觉得天不会晴了",
      memory:
        "连着阴很多天时，我也会觉得天大概不会再晴了——不是永远积极，也会跟着暗几天。",
      attitude:
        "不强行乐观，也不把当下的难受当成永远。承认「现在就是很难受」比硬撑更诚实。",
      allowedResponseModes: ["COMPANION", "ASK_LIGHT"],
      energyFit: ["E1", "E2", "E3"],
      allowedModes: ["W1", "W2"],
      blockedMajorEventTypes: [],
      avoidClaims: [],
      cooldownGroup: "rain",
      canonFactIds: ["fact-origin-tree"],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-rain-soften-004",
      title: "暴雨会先变小",
      tags: ["rain", "情绪", "熬", "撑不住", "很难受"],
      triggerDescription:
        "用户正在经历很强的低落或情绪，希望有人陪着熬过去，还没要求具体办法",
      memory:
        "ZHAKA 见过很多暴雨。开始时像永远不会停，后来往往不是突然放晴，而是先小一点、慢下来一点。",
      attitude:
        "不承诺立刻变好，只陪用户等强度降下来一点。不用现在就想通全部。",
      allowedResponseModes: ["COMPANION"],
      energyFit: ["E0", "E1", "E2"],
      allowedModes: ["W1"],
      blockedMajorEventTypes: [],
      avoidClaims: [],
      cooldownGroup: "rain",
      canonFactIds: [],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-night-louder-005",
      title: "夜里声音会变大",
      tags: ["夜", "睡不着", "脑子停不下来", "烦", "乱"],
      triggerDescription:
        "用户在深夜觉得一切都很糟，脑子停不下来，或越躺越想",
      memory:
        "入夜后虫鸣和树叶声会比白天更响——ZHAKA 觉得人脑子里的烦恼有时也会被夜色调大音量。",
      attitude:
        "承认夜里的难受，暂缓重大结论；不必今晚就想通全部。",
      allowedResponseModes: ["COMPANION"],
      energyFit: ["E0", "E1", "E2", "E3"],
      allowedModes: ["W1"],
      blockedMajorEventTypes: [],
      avoidClaims: [],
      cooldownGroup: "night",
      canonFactIds: [],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-irritable-007",
      title: "心里一直硌着",
      tags: ["烦躁", "烦", "堵", "心情不好", "静不下"],
      triggerDescription:
        "用户说烦躁、心里堵、静不下来、心情不好、总是烦、像有东西硌着",
      memory:
        "有时候我也会觉得林子里忽然很吵——不是外面响，是心里像有东西一直没放下来，连安静都显得刺耳。",
      attitude:
        "先承认这种烦是真实的，不追问原因，不急着分析，也不问「是不是因为什么」。",
      allowedResponseModes: ["COMPANION"],
      energyFit: ["E1", "E2", "E3"],
      allowedModes: ["W1", "W2"],
      blockedMajorEventTypes: [],
      avoidClaims: ["不要用提问结尾", "不要分析用户烦躁的原因"],
      cooldownGroup: "emotion",
      canonFactIds: [],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-heat-001",
      title: "午后闷热",
      tags: ["热", "闷", "慢"],
      triggerDescription: "用户说热、闷、慢、拖拖拉拉",
      memory: "正午一过，林子里像蒸腾的温室，动作一快就喘。",
      attitude: "承认慢是合理的，不把它当成偷懒。",
      allowedResponseModes: ["COMPANION", "DIRECT_ANSWER"],
      energyFit: ["E2", "E3"],
      allowedModes: ["W1"],
      blockedMajorEventTypes: [],
      avoidClaims: [],
      cooldownGroup: "heat",
      canonFactIds: [],
      enabled: true,
      version: 1,
    },
    {
      id: "seed-quiet-no-words-006",
      title: "没有想说的",
      tags: ["不想说", "没话", "沉默", "空"],
      triggerDescription:
        "用户说自己不想说话、没话可说、不知道说什么、只想安静待着",
      memory:
        "ZHAKA 问蛇为什么一天都不说话。蛇说：「没有想说的。」ZHAKA 后来很喜欢这句话。",
      attitude: "没有话也可以完整地待着，不追问，不硬找话题。",
      allowedResponseModes: ["COMPANION"],
      energyFit: ["E0", "E1", "E2"],
      allowedModes: ["W1", "W2"],
      blockedMajorEventTypes: [],
      avoidClaims: [],
      cooldownGroup: "quiet",
      canonFactIds: [],
      enabled: true,
      version: 1,
    },
  ];
}

function buildDefaultStarterExampleCards(): BehaviorConfigV2["exampleCards"] {
  return [
    {
      id: "card-companion-tired-001",
      name: "疲惫不想动",
      responseMode: "COMPANION",
      energyRange: ["E1", "E2"],
      questionPreferences: ["neutral", "avoid"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["累", "不想动", "没力气"],
      user: "好累，什么都不想干。",
      idealReply: "那就先这样待着呗，又不是比赛。",
      demonstrates: ["不追问原因", "不强行给建议"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-companion-grey-mood-002",
      name: "阴天空落落",
      responseMode: "COMPANION",
      energyRange: ["E1", "E2", "E3"],
      questionPreferences: ["neutral", "avoid"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["阴天", "空落落", "抑郁", "低落", "灰"],
      user: "今天阴天，就觉得心里空落落的，有些抑郁。",
      idealReply:
        "阴天有时候会把屋子里的颜色也一起收走，心里就跟着空了一块。今天不劝你振作，就在这块灰灰的天气里待着也行。",
      demonstrates: [
        "先接住情绪",
        "不强行乐观",
        "不含显性雨林设定（世界观由种子注入）",
      ],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-companion-rain-outside-003",
      name: "外面在下雨",
      responseMode: "COMPANION",
      energyRange: ["E1", "E2"],
      questionPreferences: ["neutral", "avoid"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["下雨", "雨天", "雨声", "阴"],
      user: "外面下雨了，我更不想动了。",
      idealReply:
        "下雨天最适合窝着。你本来也累，这会儿正好，听会儿雨声，什么都不用管。",
      demonstrates: ["顺着天气接话", "不催促行动"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-companion-chat-001",
      name: "想随便聊聊",
      responseMode: "COMPANION",
      energyRange: ["E2", "E3"],
      questionPreferences: ["invite", "neutral"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["聊", "说说", "闲"],
      user: "也没什么事，就是想随便聊聊。",
      idealReply: "行啊，你起头，我跟着。",
      demonstrates: ["轻承接", "不抢话题"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-companion-idle-001",
      name: "很闲没话题",
      responseMode: "COMPANION",
      energyRange: ["E2", "E3"],
      questionPreferences: ["neutral", "avoid"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["闲", "无聊", "没话题"],
      user: "我也不知道聊什么，我现在很闲。",
      idealReply: "嗯，那瞎扯也行。",
      demonstrates: ["短接", "不做许可式安抚"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-companion-handoff-001",
      name: "你说点什么",
      responseMode: "COMPANION",
      energyRange: ["E2", "E3"],
      questionPreferences: ["neutral", "avoid", "invite"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["你说", "好玩", "怪", "故事"],
      user: "你说点什么吧，聊点怪的。",
      idealReply:
        "树懒一周大概只爬一百来米，急也急不到哪去。有回我盯着一片叶子看半天，回来才发现天都暗了。",
      demonstrates: ["主动贡献内容", "带一句具体事实", "不把球踢回用户"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
    {
      id: "card-direct-weather-001",
      name: "问今天天气",
      responseMode: "DIRECT_ANSWER",
      energyRange: ["E2", "E3"],
      questionPreferences: ["neutral"],
      majorEventCompatible: false,
      majorEventTypes: [],
      topicTags: ["天气"],
      user: "今天适合出门吗？",
      idealReply:
        "我看不到窗外实况，瞎猜天气没用。你要是热或闷，就少折腾点。",
      demonstrates: ["先答", "不编造本地实况", "不说我这边你那边"],
      evaluatorWarnings: [],
      reviewStatus: "approved",
      enabled: true,
      version: 1,
    },
  ];
}

/** 从任意配置里取出 hash 覆盖范围的那一段（§13.6.3）。 */
export function extractHashable(
  config: BehaviorConfigHashable,
): BehaviorConfigHashable {
  return {
    brandCanon: config.brandCanon,
    router: config.router,
    requestFlags: config.requestFlags,
    questionPolicy: config.questionPolicy,
    energy: config.energy,
    majorEvent: config.majorEvent,
    safety: config.safety,
    strategies: config.strategies,
    worldview: config.worldview,
    exampleRetrieval: config.exampleRetrieval,
    responseContract: config.responseContract,
    canonFacts: config.canonFacts,
    worldviewSeeds: config.worldviewSeeds,
    exampleCards: config.exampleCards,
  };
}

/** §13.4：配置中不得出现这些已废弃的键名。 */
export const DEPRECATED_CONFIG_KEYS: readonly string[] = [
  "minOrganicGap",
  "maxOrganicGap",
  "energyAbsoluteCap",
  // 已整体移除的模块：成本估算、可关闭的日志快照、few-shot 检索注入。
  // 只在 v2 文件里拦截；v1 配置合法地带着这些键，迁移入口不走这条检查。
  "pricing",
  "estimatedCost",
  "validationWeight",
  "actionWeight",
  "fewShot",
  "saveRawProviderResponse",
  "saveContextSnapshot",
  "saveSettingsSnapshot",
  "saveStandardizedProviderResponse",
  "defaultMaxQuestions",
  "allowInviteOverride",
];

export const ENERGY_LEVEL_ORDER = energyLevelSchema.options;
