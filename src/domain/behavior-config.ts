import { z } from "zod";
import {
  behaviorExampleCardSchema,
  buildDefaultExampleRetrievalSettings,
  exampleRetrievalSettingsSchema,
} from "./behavior-example";
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
  defaultMaxQuestions: z.number().int().min(0).max(2),
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

/**
 * 活动配置：不含 `exportedAt`。该字段只在导出时写入（§13）。
 * 把它排除在活动配置之外，才能让「同一份配置连续导出两次得到相同 hash」
 * 这条要求在类型层面就成立。
 */
export const behaviorConfigV2Schema = z
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
export type BehaviorConfigV2 = z.infer<typeof behaviorConfigV2Schema>;

/** 导出文件在活动配置之上多一个 `exportedAt`（§13.6.3 明确排除在 hash 外）。 */
export const behaviorConfigExportSchema = behaviorConfigV2Schema
  .extend({
    exportedAt: z.string().datetime({ offset: true }),
  })
  .strict();
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
  behaviorConfigExportSchema,
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
        defaultMaxQuestions: 0,
        defaultMaxActions: 0,
        providerMaxOutputTokens: 180,
      },
      E1: {
        label: "0 电量",
        targetMinChars: 40,
        targetMaxChars: 140,
        hardMaxChars: 180,
        maxSentences: 3,
        defaultMaxQuestions: 0,
        defaultMaxActions: 0,
        providerMaxOutputTokens: 260,
      },
      E2: {
        label: "低电量",
        targetMinChars: 80,
        targetMaxChars: 220,
        hardMaxChars: 300,
        maxSentences: 5,
        defaultMaxQuestions: 1,
        defaultMaxActions: 1,
        providerMaxOutputTokens: 460,
      },
      E3: {
        label: "中高电量",
        targetMinChars: 120,
        targetMaxChars: 420,
        hardMaxChars: 600,
        maxSentences: 8,
        defaultMaxQuestions: 2,
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
      enabled: false,
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
      urgentPlaceholderText: "危险危险危险。",
      rules: [],
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

    canonFacts: [],
    worldviewSeeds: [],
    exampleCards: [],
  };
}

/** 从任意配置里取出 hash 覆盖范围的那一段（§13.6.3）。 */
export function extractHashable(
  config: BehaviorConfigHashable,
): BehaviorConfigHashable {
  return {
    brandCanon: config.brandCanon,
    router: config.router,
    requestFlags: config.requestFlags,
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
];

export const ENERGY_LEVEL_ORDER = energyLevelSchema.options;
