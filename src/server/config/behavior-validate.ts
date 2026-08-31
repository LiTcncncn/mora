import "server-only";
import {
  HIGH_FREQUENCY_MODES,
  MIN_AVOID_CARDS,
  MIN_ENERGY_SPREAD_PER_MODE,
  isRetrievable,
  requiredCardCount,
} from "@/domain/behavior-example";
import {
  CHARS_TO_TOKENS_RATIO,
  DEPRECATED_CONFIG_KEYS,
  ENERGY_LEVEL_ORDER,
  type BehaviorConfigV2,
} from "@/domain/behavior-config";
import { RESPONSE_MODES, type ResponseMode } from "@/domain/behavior-taxonomy";
import {
  INVITE_OVERRIDE_FORBIDDEN_MODES,
  worldviewCapableModes,
} from "@/domain/strategy-policy";
import type { EnergyLevel } from "@/domain/common";

/**
 * §13.4 的校验清单。
 *
 * 同一份清单服务保存与导入两条路径，但**失败处理不同**（§13.6.6）：
 * 保存是单点修改可直接拒绝，导入是整包替换需区分「拒绝整包」
 * 「导入并自动禁用该条」「仅警告」三种处置。
 *
 * 因此校验函数只产出带类别的问题清单，由 `resolveForSave` /
 * `resolveForImport` 决定处置。把处置逻辑写进校验里会让两条路径必须各写
 * 一套校验，而两套校验必然分叉。
 */

export type IssueCategory =
  /** 硬约束违反：两条路径都拒绝 */
  | "hard"
  /** 引用完整性：保存拒绝启用该条，导入自动禁用该条 */
  | "reference"
  /** 死种子（D56）：保存警告并阻塞启用，导入自动禁用该条 */
  | "dead_seed"
  /** canon lint 命中禁词：保存拒绝，导入自动禁用该条 */
  | "forbidden_term"
  /** 软约束：两条路径都只警告 */
  | "soft";

export type AssetKind = "canonFact" | "worldviewSeed" | "exampleCard";

export interface AssetRef {
  kind: AssetKind;
  id: string;
}

export interface ValidationIssue {
  code: string;
  category: IssueCategory;
  message: string;
  /** 指向单条记录的问题才有，决定导入路径能否自动禁用（§13.6.6）。 */
  target?: AssetRef;
}

// ------------------------------------------------------------ 校验

export function validateBehaviorConfig(
  config: BehaviorConfigV2,
): ValidationIssue[] {
  return [
    ...validateEnergy(config),
    ...validateStrategies(config),
    ...validateWorldviewScheduler(config),
    ...validateAssetReferences(config),
    ...validateDeadSeeds(config),
    ...validateCanonLint(config),
    ...validateExampleCoverage(config),
    ...validateDeprecatedKeys(config),
  ];
}

function validateEnergy(config: BehaviorConfigV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { budgets } = config.energy;

  for (const level of ENERGY_LEVEL_ORDER) {
    const budget = budgets[level];

    if (budget.hardMaxChars < budget.targetMaxChars) {
      issues.push({
        code: "energy.hard_below_target",
        category: "hard",
        message: `${level} 的 hardMaxChars (${budget.hardMaxChars}) 小于 targetMaxChars (${budget.targetMaxChars})`,
      });
    }
    if (budget.targetMinChars > budget.targetMaxChars) {
      issues.push({
        code: "energy.min_above_max",
        category: "hard",
        message: `${level} 的 targetMinChars (${budget.targetMinChars}) 大于 targetMaxChars (${budget.targetMaxChars})`,
      });
    }

    // token 上限低于篇幅目标会让回复被 provider 截断在句子中间（§4.3）。
    const minimumTokens = Math.ceil(budget.hardMaxChars * CHARS_TO_TOKENS_RATIO);
    if (budget.providerMaxOutputTokens < minimumTokens) {
      issues.push({
        code: "energy.provider_tokens_low",
        category: "soft",
        message: `${level} 的 providerMaxOutputTokens (${budget.providerMaxOutputTokens}) 低于 hardMaxChars × 0.7 (${minimumTokens})，回复可能被 provider 截断在句子中间`,
      });
    }
  }

  // 逐档不下降：E0 的上限不该高于 E1（§13.4）。
  for (let index = 1; index < ENERGY_LEVEL_ORDER.length; index += 1) {
    const lower = ENERGY_LEVEL_ORDER[index - 1]!;
    const higher = ENERGY_LEVEL_ORDER[index]!;

    if (budgets[higher].targetMaxChars < budgets[lower].targetMaxChars) {
      issues.push({
        code: "energy.target_not_monotonic",
        category: "hard",
        message: `targetMaxChars 逐档下降：${higher} (${budgets[higher].targetMaxChars}) 低于 ${lower} (${budgets[lower].targetMaxChars})`,
      });
    }
    if (budgets[higher].hardMaxChars < budgets[lower].hardMaxChars) {
      issues.push({
        code: "energy.hard_not_monotonic",
        category: "hard",
        message: `hardMaxChars 逐档下降：${higher} (${budgets[higher].hardMaxChars}) 低于 ${lower} (${budgets[lower].hardMaxChars})`,
      });
    }
  }

  return issues;
}

function validateStrategies(config: BehaviorConfigV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const mode of RESPONSE_MODES) {
    const policy = config.strategies[mode];
    if (!policy) {
      issues.push({
        code: "strategy.missing",
        category: "hard",
        message: `缺少 Response Mode ${mode} 的策略配置`,
      });
      continue;
    }
    if (policy.id !== mode) {
      issues.push({
        code: "strategy.id_mismatch",
        category: "hard",
        message: `策略 ${mode} 的 id 字段为 ${policy.id}，与其键名不一致`,
      });
    }
  }

  // D54：这三组的 mustAvoid 都写着不要追问，允许 invite 推翻会让配置与
  // 自己的行为规则冲突。
  for (const mode of INVITE_OVERRIDE_FORBIDDEN_MODES) {
    if (config.strategies[mode]?.allowInviteOverride === true) {
      issues.push({
        code: "strategy.invite_override_forbidden",
        category: "hard",
        message: `${mode} 的 allowInviteOverride 必须为 false（D54）：该策略的 mustAvoid 已禁止追问`,
      });
    }
  }

  // §8.1 编译期校验：lengthMultiplier 作用后不得超过对应档的 hardMaxChars。
  for (const mode of RESPONSE_MODES) {
    const policy = config.strategies[mode];
    if (!policy) continue;

    for (const level of ENERGY_LEVEL_ORDER) {
      const budget = config.energy.budgets[level];
      const applied = Math.round(budget.targetMaxChars * policy.lengthMultiplier);
      if (applied > budget.hardMaxChars) {
        issues.push({
          code: "strategy.length_exceeds_hard_max",
          category: "soft",
          message: `${mode} 在 ${level} 的 targetMax 经 lengthMultiplier (${policy.lengthMultiplier}) 作用后为 ${applied}，超过 hardMaxChars (${budget.hardMaxChars})，编译时将 clamp`,
        });
      }
    }
  }

  return issues;
}

function validateWorldviewScheduler(
  config: BehaviorConfigV2,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const {
    minEligibleTurnsBetweenOrganic,
    maxEligibleTurnsBetweenOrganic,
    rollingEligibleWindow,
  } = config.worldview;

  if (minEligibleTurnsBetweenOrganic >= maxEligibleTurnsBetweenOrganic) {
    issues.push({
      code: "worldview.eligible_gap_inverted",
      category: "hard",
      message: `minEligibleTurnsBetweenOrganic (${minEligibleTurnsBetweenOrganic}) 必须小于 maxEligibleTurnsBetweenOrganic (${maxEligibleTurnsBetweenOrganic})`,
    });
  }

  // 窗口太短会让 rollingNeed 失去意义（§13.4）。
  const minimumWindow = maxEligibleTurnsBetweenOrganic * 2;
  if (rollingEligibleWindow < minimumWindow) {
    issues.push({
      code: "worldview.rolling_window_too_short",
      category: "soft",
      message: `rollingEligibleWindow (${rollingEligibleWindow}) 小于 maxEligibleTurnsBetweenOrganic × 2 (${minimumWindow})，滑动窗口需求将失去意义`,
    });
  }

  return issues;
}

function validateAssetReferences(config: BehaviorConfigV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const factsById = new Map(config.canonFacts.map((fact) => [fact.id, fact]));

  for (const seed of config.worldviewSeeds) {
    for (const factId of seed.canonFactIds) {
      const fact = factsById.get(factId);
      if (!fact) {
        issues.push({
          code: "seed.canon_fact_missing",
          category: "reference",
          message: `种子 ${seed.id}（${seed.title}）引用的 Canon Fact ${factId} 不存在`,
          target: { kind: "worldviewSeed", id: seed.id },
        });
        continue;
      }
      // 只有启用的种子需要引用完整：软删除的种子留着供历史 Run 解释（§9.10）。
      if (!fact.enabled && seed.enabled) {
        issues.push({
          code: "seed.canon_fact_disabled",
          category: "reference",
          message: `种子 ${seed.id}（${seed.title}）引用的 Canon Fact ${factId} 已禁用`,
          target: { kind: "worldviewSeed", id: seed.id },
        });
      }
    }
  }

  return issues;
}

/**
 * D56 死种子校验：启用的种子，其 `allowedResponseModes` 必须至少有一个 mode
 * 的 `allowWorldview=true`。
 *
 * 不满足时这颗种子永远不会被选中——`allowWorldview=false` 的 mode 不产生
 * 合格轮，也就没有「可用种子」。D32 曾专门为 CLOSE 补种子，结果这些种子
 * 在自然世界观流程里永远选不中，这条校验就是为了让同类错误当场暴露。
 */
function validateDeadSeeds(config: BehaviorConfigV2): ValidationIssue[] {
  const capable = new Set(worldviewCapableModes(config.strategies));

  return config.worldviewSeeds
    .filter((seed) => seed.enabled)
    .filter((seed) => !seed.allowedResponseModes.some((mode) => capable.has(mode)))
    .map((seed) => ({
      code: "seed.dead",
      category: "dead_seed" as const,
      message: `种子 ${seed.id}（${seed.title}）的 allowedResponseModes [${seed.allowedResponseModes.join(", ")}] 全部禁用世界观，这颗种子永远不会被选中`,
      target: { kind: "worldviewSeed" as const, id: seed.id },
    }));
}

/**
 * canon lint（D7）：活动配置与新内容强校验，历史会话与 Run 快照豁免。
 *
 * 只扫内容资产与品牌表述，**不扫 `worldview.canonLint.forbiddenLegacyTerms`
 * 自身**——禁词表列出这些词是它的职责，把它当成违规内容是最容易犯的错。
 */
function validateCanonLint(config: BehaviorConfigV2): ValidationIssue[] {
  const terms = config.worldview.canonLint.forbiddenLegacyTerms;
  if (terms.length === 0) return [];

  const issues: ValidationIssue[] = [];

  const hit = (text: string): string[] =>
    terms.filter((term) => text.includes(term));

  for (const fact of config.canonFacts) {
    const matched = hit([fact.content, ...fact.aliases].join("\n"));
    if (matched.length > 0) {
      issues.push({
        code: "canon_lint.fact",
        category: "forbidden_term",
        message: `Canon Fact ${fact.id} 命中已废弃设定词：${matched.join("、")}`,
        target: { kind: "canonFact", id: fact.id },
      });
    }
  }

  for (const seed of config.worldviewSeeds) {
    const matched = hit(
      [
        seed.title,
        seed.triggerDescription,
        seed.memory,
        seed.attitude,
        ...seed.tags,
        ...seed.avoidClaims,
      ].join("\n"),
    );
    if (matched.length > 0) {
      issues.push({
        code: "canon_lint.seed",
        category: "forbidden_term",
        message: `种子 ${seed.id}（${seed.title}）命中已废弃设定词：${matched.join("、")}`,
        target: { kind: "worldviewSeed", id: seed.id },
      });
    }
  }

  for (const card of config.exampleCards) {
    const matched = hit(
      [card.name, card.user, card.idealReply, ...card.topicTags].join("\n"),
    );
    if (matched.length > 0) {
      issues.push({
        code: "canon_lint.example",
        category: "forbidden_term",
        message: `示例卡 ${card.id}（${card.name}）命中已废弃设定词：${matched.join("、")}`,
        target: { kind: "exampleCard", id: card.id },
      });
    }
  }

  const brandMatched = hit(
    [config.brandCanon.originStatement, config.brandCanon.arrivalStatement].join(
      "\n",
    ),
  );
  if (brandMatched.length > 0) {
    // 品牌表述不是单条资产，无法「导入并禁用」，因此按硬约束处理。
    issues.push({
      code: "canon_lint.brand",
      category: "hard",
      message: `品牌表述命中已废弃设定词：${brandMatched.join("、")}`,
    });
  }

  return issues;
}

/** §11.6：覆盖门槛。未达门槛只警告，并在覆盖矩阵中标红。 */
function validateExampleCoverage(config: BehaviorConfigV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const retrievable = config.exampleCards.filter(isRetrievable);

  for (const mode of RESPONSE_MODES) {
    const matched = retrievable.filter((card) => card.responseMode === mode);
    const required = requiredCardCount(mode);

    if (matched.length < required) {
      issues.push({
        code: "example.below_threshold",
        category: "soft",
        message: `${mode} 只有 ${matched.length} 张可检索示例卡，未达门槛 ${required} 张${HIGH_FREQUENCY_MODES.includes(mode) ? "（高频档）" : ""}`,
      });
    }

    const energies = new Set<EnergyLevel>(
      matched.flatMap((card) => card.energyRange),
    );
    if (matched.length > 0 && energies.size < MIN_ENERGY_SPREAD_PER_MODE) {
      issues.push({
        code: "example.energy_spread_low",
        category: "soft",
        message: `${mode} 的示例卡只覆盖 ${energies.size} 个 Energy 档，门槛 ${MIN_ENERGY_SPREAD_PER_MODE} 个`,
      });
    }
  }

  const avoidCards = retrievable.filter((card) =>
    card.questionPreferences.includes("avoid"),
  );
  if (avoidCards.length < MIN_AVOID_CARDS) {
    issues.push({
      code: "example.avoid_below_threshold",
      category: "soft",
      message: `questionPreference=avoid 的示例卡只有 ${avoidCards.length} 张，门槛 ${MIN_AVOID_CARDS} 张（跨 mode 计）`,
    });
  }

  return issues;
}

/**
 * §13.4：配置中不出现已废弃的键名。
 *
 * `behaviorConfigV2Schema` 是 strict 的，顶层多余键本已被挡住；这条检查的
 * 意义在于给出**指名的错误信息**——「配置里还有 minOrganicGap」比
 * 「未知字段」更能让人知道该改哪里，尤其在从 v1 手工改配置的场景。
 */
function validateDeprecatedKeys(config: BehaviorConfigV2): ValidationIssue[] {
  const serialized = JSON.stringify(config);

  return DEPRECATED_CONFIG_KEYS.filter((key) =>
    serialized.includes(`"${key}"`),
  ).map((key) => ({
    code: "config.deprecated_key",
    category: "hard" as const,
    message: `配置中出现已废弃的键名 ${key}`,
  }));
}

// ------------------------------------------------------------ 处置

export interface SaveResolution {
  ok: boolean;
  /** 阻塞保存的问题。 */
  blocking: ValidationIssue[];
  /** 允许保存但需提示的问题。 */
  warnings: ValidationIssue[];
  /**
   * 阻塞启用的单条记录（§13.6.6：保存路径「拒绝启用该条」）。
   * 与 blocking 分开：整份配置仍可保存，只是这些记录不能置为 enabled。
   */
  blockedFromEnabling: AssetRef[];
}

/** 保存路径：单点修改，硬约束与禁词直接拒绝。 */
export function resolveForSave(issues: ValidationIssue[]): SaveResolution {
  const blocking = issues.filter(
    (issue) =>
      issue.category === "hard" || issue.category === "forbidden_term",
  );
  const blockedFromEnabling = issues
    .filter(
      (issue) =>
        (issue.category === "reference" || issue.category === "dead_seed") &&
        issue.target !== undefined,
    )
    .map((issue) => issue.target!);

  return {
    ok: blocking.length === 0,
    blocking,
    warnings: issues.filter(
      (issue) => issue.category === "soft" || issue.category === "dead_seed",
    ),
    blockedFromEnabling,
  };
}

export interface ImportResolution {
  /**
   * 拒绝整包。**不做部分导入**是硬原则（§13.6.6）：部分导入会产生一个
   * 既不是文件内容也不是原配置的第三种状态，事后无法解释配置从何而来。
   */
  rejected: boolean;
  rejectionReasons: ValidationIssue[];
  /**
   * 导入但自动置为 enabled=false 的记录。
   *
   * 引用完整性、死种子与禁词三类采用「导入并禁用」而非拒绝整包，原因是
   * 它们是单条记录的问题，禁用后不影响运行。拒绝整包会让一颗坏种子
   * 挡住 70 条好种子的迁移。
   */
  autoDisabled: Array<{ target: AssetRef; reason: string }>;
  warnings: ValidationIssue[];
}

/** 导入路径：整包替换，单条记录的问题降级为自动禁用。 */
export function resolveForImport(
  issues: ValidationIssue[],
): ImportResolution {
  const rejectionReasons = issues.filter((issue) => issue.category === "hard");

  const autoDisabled = issues
    .filter(
      (issue) =>
        (issue.category === "reference" ||
          issue.category === "dead_seed" ||
          issue.category === "forbidden_term") &&
        issue.target !== undefined,
    )
    .map((issue) => ({ target: issue.target!, reason: issue.message }));

  return {
    rejected: rejectionReasons.length > 0,
    rejectionReasons,
    autoDisabled,
    warnings: issues.filter((issue) => issue.category === "soft"),
  };
}

/** 把 `autoDisabled` 落到配置上。返回新配置，不改原对象。 */
export function applyAutoDisable(
  config: BehaviorConfigV2,
  autoDisabled: ImportResolution["autoDisabled"],
): BehaviorConfigV2 {
  if (autoDisabled.length === 0) return config;

  const disabledIds = (kind: AssetKind): Set<string> =>
    new Set(
      autoDisabled
        .filter((entry) => entry.target.kind === kind)
        .map((entry) => entry.target.id),
    );

  const facts = disabledIds("canonFact");
  const seeds = disabledIds("worldviewSeed");
  const cards = disabledIds("exampleCard");

  return {
    ...config,
    canonFacts: config.canonFacts.map((fact) =>
      facts.has(fact.id) ? { ...fact, enabled: false } : fact,
    ),
    worldviewSeeds: config.worldviewSeeds.map((seed) =>
      seeds.has(seed.id) ? { ...seed, enabled: false } : seed,
    ),
    exampleCards: config.exampleCards.map((card) =>
      cards.has(card.id) ? { ...card, enabled: false } : card,
    ),
  };
}

/** 覆盖矩阵：行为 Response Mode，列为 Energy 档（§11.6 的 Lab 视图）。 */
export function buildCoverageMatrix(
  config: BehaviorConfigV2,
): Array<{
  mode: ResponseMode;
  required: number;
  total: number;
  perEnergy: Record<EnergyLevel, number>;
  meetsThreshold: boolean;
}> {
  const retrievable = config.exampleCards.filter(isRetrievable);

  return RESPONSE_MODES.map((mode) => {
    const matched = retrievable.filter((card) => card.responseMode === mode);
    const perEnergy = Object.fromEntries(
      ENERGY_LEVEL_ORDER.map((level) => [
        level,
        matched.filter((card) => card.energyRange.includes(level)).length,
      ]),
    ) as Record<EnergyLevel, number>;

    const required = requiredCardCount(mode);
    const energySpread = ENERGY_LEVEL_ORDER.filter(
      (level) => perEnergy[level] > 0,
    ).length;

    return {
      mode,
      required,
      total: matched.length,
      perEnergy,
      meetsThreshold:
        matched.length >= required && energySpread >= MIN_ENERGY_SPREAD_PER_MODE,
    };
  });
}
