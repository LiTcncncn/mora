import "server-only";
import {
  buildDefaultBehaviorConfig,
  type BehaviorConfigV2,
} from "@/domain/behavior-config";
import type { BehaviorExampleCard } from "@/domain/behavior-example";
import type { ResponseMode } from "@/domain/behavior-taxonomy";
import type { MoraConfigBundle } from "@/domain/config-bundle";
import type { FewShotSample } from "@/domain/fewshot";
import type { EnergyLevel } from "@/domain/common";
import { computeConfigHash } from "./behavior-hash";

/**
 * §18.1：v1 → v2 迁移。
 *
 * 迁移只产出**预览候选**，不落库；提交由 `behavior-import.ts` 的第三阶段负责。
 *
 * 行为文本不做逐句迁移（§25.2）：旧 `toneInstruction`/`responseInstruction`
 * 是按旧能量语义和旧场景流程写的，而 v2 的能量只表示承载力、策略拆成了
 * 8 个 Response Mode，逐句搬运只会把旧的分类错误带进新结构。因此迁移器
 * 只搬**数值**与**语料**，规则文本一律取代码常量。
 */

/** §18.2：自动迁移只能生成待审核候选，人工确认后才启用。 */
const MIGRATED_CARD_REVIEW_STATUS = "pending" as const;

export interface MigrationReport {
  /**
   * `fewShotSamples` 的三态语义（§13.6.2）。混为一谈会把用户既有语料清空。
   * - `absent`：字段缺失，表示「这份配置不管样本」，不生成任何候选；
   * - `explicit_empty`：显式空数组，表示「清空样本」，生成零张卡；
   * - `present`：有样本，逐条转成候选卡。
   */
  fewShotSource: "absent" | "explicit_empty" | "present";
  fewShotSampleCount: number;
  /** 生成的示例卡候选数。全部为 reviewStatus=pending。 */
  exampleCardCandidates: number;
  /** 含世界观的样本需另外拆出种子，迁移器不自动生成，只列出待办。 */
  seedCandidatesPending: Array<{ sourceSampleId: string; scene: string }>;
  /** 从 v1 energy policies 搬过来的数值。 */
  migratedEnergyFields: string[];
  /** 冲突与丢弃项，逐条记录（§0 要求迁移报告记录冲突及处理结果）。 */
  notes: string[];
}

export interface MigrationResult {
  /** 未回填 configHash 的 v2 候选。 */
  config: BehaviorConfigV2;
  report: MigrationReport;
}

/**
 * v1 的 `worldview` 级别到 v2 的映射。
 *
 * v1 用 `none`/`L1`/`L2` 标在示例上，同时决定「示范怎么说话」和
 * 「提供什么世界观内容」。v2 里前者归示例卡、后者归种子，因此 L1/L2 的样本
 * 必须拆成两个候选——迁移器只能生成不含世界观的那一半，种子要人工写。
 */
function needsSeedSplit(sample: FewShotSample): boolean {
  return sample.worldview !== "none";
}

/**
 * 推断 Response Mode。
 *
 * 与 `scripts/inventory-phase0.mjs` 的推断口径刻意保持一致但不共享实现：
 * 脚本是一次性盘点，这里是产品代码路径，两者的生命周期不同。推断结果全部
 * 落到 `reviewStatus=pending`，因此推错的代价是人工改一个下拉框，
 * 不是错误行为进入运行。
 */
function inferResponseMode(sample: FewShotSample): ResponseMode {
  const text = `${sample.scene}\n${sample.user}`;

  if (/结束对话|我睡了|不聊了|改天|明天再说/.test(text)) return "CLOSE";
  if (/怼我|嫌被问|不想被安慰|像客服|别再问|你没懂/.test(text)) return "REPAIR";
  if (/已经选定|那我先|我决定|我打算就/.test(text)) return "CONFIRM_CHOICE";
  if (/完成|好消息|终于|做完了|我.*过了/.test(text)) return "CELEBRATE";
  if (/怎么办|怎么开始|怎么弄|该做什么/.test(text)) return "ONE_STEP_HELP";
  if (/该不该|为什么|算不算|是不是|[?？]$/.test(text)) return "DIRECT_ANSWER";
  if (/想被问|想说说|你怎么不问|陪我聊/.test(text)) return "ASK_LIGHT";

  // 兜底 COMPANION：§7.3 的定义就是「没有明确要求解决问题」，兜底命中它
  // 是正确的默认。
  return "COMPANION";
}

function energyRangeFor(sample: FewShotSample): EnergyLevel[] {
  return sample.energy === "any"
    ? ["E0", "E1", "E2", "E3"]
    : [sample.energy];
}

function questionPreferencesFor(
  sample: FewShotSample,
): Array<"invite" | "neutral" | "avoid"> {
  const text = `${sample.scene}\n${sample.user}`;
  if (/别问|不想说|不想被问|嫌被问|别再问/.test(text)) return ["avoid"];
  if (/想被问|想说说|你怎么不问/.test(text)) return ["invite"];
  return ["neutral"];
}

function toExampleCard(sample: FewShotSample): BehaviorExampleCard {
  return {
    // id 保留原值：内容资产的 id 被历史 Run 引用（§13.6.5）。
    id: sample.id,
    name: sample.scene,
    responseMode: inferResponseMode(sample),
    energyRange: energyRangeFor(sample),
    questionPreferences: questionPreferencesFor(sample),
    // 旧样本没有重大事件维度，一律按不兼容处理——错判成兼容会让一条普通
    // 语料在重大事件首轮被选中，那是最伤体验的错误。
    majorEventCompatible: false,
    majorEventTypes: [],
    topicTags: sample.keywords.slice(0, 20),
    user: sample.user,
    idealReply: sample.reply,
    // 旧 note 是给人看的自由文本规则，不是可执行的示范说明（§11.4），
    // 因此不进 demonstrates，只在迁移报告里留痕。
    demonstrates: [],
    evaluatorWarnings: [],
    reviewStatus: MIGRATED_CARD_REVIEW_STATUS,
    enabled: false,
    version: 1,
  };
}

export function migrateV1ToV2(
  bundle: MoraConfigBundle,
  targetProfileName: string,
): MigrationResult {
  const base = buildDefaultBehaviorConfig(
    bundle.sourceProfileName || targetProfileName,
  );
  const notes: string[] = [];

  // ---- 能量数值：只搬能对上的字段 ----
  const migratedEnergyFields: string[] = [];
  const budgets = { ...base.energy.budgets };

  for (const level of ["E0", "E1", "E2", "E3"] as const) {
    const legacy = bundle.settings.energy.policies[level];
    if (!legacy) continue;

    // hardMaxChars 是 v2 新增概念，v1 没有对应字段。保留 v2 默认值而不是
    // 按 v1 的 targetMaxChars 抬高：抬高会绕过 §4.3 定好的四档梯度。
    //
    // 因此 v1 的 targetMaxChars 必须收敛到 v2 的 hardMaxChars 以内。
    // 直接搬运会产出 hardMaxChars < targetMaxChars 的配置，那违反 §13.4
    // 的硬约束，整包会被自己的校验拒绝——旧配置就永远迁不过来了。
    const hardMax = budgets[level].hardMaxChars;
    const targetMaxChars = Math.min(legacy.targetMaxChars, hardMax);

    budgets[level] = {
      ...budgets[level],
      targetMaxChars,
      maxSentences: legacy.targetMaxSentences,
      defaultMaxQuestions: Math.min(2, legacy.maxQuestions),
      defaultMaxActions: Math.min(2, legacy.maxSuggestedActions),
    };
    migratedEnergyFields.push(
      `${level}.targetMaxChars`,
      `${level}.maxSentences`,
      `${level}.defaultMaxQuestions`,
      `${level}.defaultMaxActions`,
    );

    if (legacy.targetMaxChars > hardMax) {
      notes.push(
        `${level} 的 v1 targetMaxChars (${legacy.targetMaxChars}) 超过 v2 的 hardMaxChars (${hardMax})，已收敛到 ${hardMax}。v2 的四档梯度按 §4.3 重新定过，旧值不再适用；如确需更长回复，请在 Lab 内同时调高该档的 hardMaxChars`,
      );
    }
    if (legacy.maxQuestions > 2) {
      notes.push(
        `${level} 的 v1 maxQuestions 为 ${legacy.maxQuestions}，已收敛到 v2 上限 2`,
      );
    }
    if (legacy.maxSuggestedActions > 2) {
      notes.push(
        `${level} 的 v1 maxSuggestedActions 为 ${legacy.maxSuggestedActions}，已收敛到 v2 上限 2`,
      );
    }
  }

  notes.push(
    "v1 的 toneInstruction 与 responseInstruction 未逐句迁移（§25.2）：它们按旧能量语义撰写，分类前提在 v2 已不成立。行为规则统一取 §8.2 的代码常量",
  );

  // ---- few-shot：三态语义必须保住（§13.6.2）----
  let fewShotSource: MigrationReport["fewShotSource"];
  let exampleCards: BehaviorExampleCard[] = [];
  const seedCandidatesPending: MigrationReport["seedCandidatesPending"] = [];

  if (bundle.fewShotSamples === undefined) {
    fewShotSource = "absent";
    notes.push(
      "源配置不含 fewShotSamples 字段，语义为「这份配置不管样本」，未生成任何示例卡候选，现有语料保持不动",
    );
  } else if (bundle.fewShotSamples.length === 0) {
    fewShotSource = "explicit_empty";
    notes.push(
      "源配置显式清空：fewShotSamples 为显式空数组，语义为「清空样本」，生成零张示例卡",
    );
  } else {
    fewShotSource = "present";
    exampleCards = bundle.fewShotSamples.map(toExampleCard);

    for (const sample of bundle.fewShotSamples) {
      if (!needsSeedSplit(sample)) continue;
      seedCandidatesPending.push({
        sourceSampleId: sample.id,
        scene: sample.scene,
      });
    }

    if (seedCandidatesPending.length > 0) {
      notes.push(
        `${seedCandidatesPending.length} 条样本含显性世界观，需按 §18.2 另外拆出世界观种子。迁移器只生成了不含世界观的示例卡一半，种子需人工撰写`,
      );
    }
    notes.push(
      `${exampleCards.length} 张示例卡全部为 reviewStatus=pending 且 enabled=false，人工审核后才进入检索（§18.2）`,
    );
    notes.push(
      "旧 note 字段是给人看的自由文本规则，不作为示范说明迁入 demonstrates（§11.4）",
    );
  }

  const withoutHash: Omit<BehaviorConfigV2, "configHash"> = {
    ...base,
    energy: { ...base.energy, budgets },
    exampleCards,
  };

  const config: BehaviorConfigV2 = {
    ...withoutHash,
    configHash: computeConfigHash(withoutHash),
  };

  return {
    config,
    report: {
      fewShotSource,
      fewShotSampleCount: bundle.fewShotSamples?.length ?? 0,
      exampleCardCandidates: exampleCards.length,
      seedCandidatesPending,
      migratedEnergyFields,
      notes,
    },
  };
}
