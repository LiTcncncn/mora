import "server-only";
import {
  behaviorConfigV2Schema,
  type BehaviorConfigV2,
  type LabRuntimeExport,
} from "@/domain/behavior-config";
import { reconcileStrategyPolicies } from "@/domain/strategy-policy";
import { AppError } from "../api/errors";
import { computeConfigHash } from "./behavior-hash";
import {
  detectConfigFile,
  type DetectedFile,
  type TransferKind,
} from "./behavior-transfer";
import { migrateV1ToV2, type MigrationReport } from "./behavior-migrate";
import {
  applyAutoDisable,
  resolveForImport,
  validateBehaviorConfig,
  type ImportResolution,
} from "./behavior-validate";
import {
  detectVersionDowngrades,
  type VersionDowngrade,
} from "./behavior-versions";

/**
 * §13.6.5：三阶段导入。
 *
 * **任何阶段失败都不改动活动配置。** 这个模块因此拆成两个导出函数：
 * `prepareImport` 做阶段一与阶段二（纯计算，无副作用），
 * `commitImport` 做阶段三。两者之间必须有一次用户显式确认——
 * §18.1 已定「不得静默覆盖用户旧配置」，所以确认不可跳过，
 * 也不提供「记住我的选择」（一个可以被记住的确认等于没有确认）。
 */

export interface ImportPreview {
  kind: TransferKind;
  sourceGeneration: 1 | 2;
  sourceProfileName: string;
  /** 文件内声明的 hash。单库文件与 v1 文件没有这个字段。 */
  declaredConfigHash: string | null;
  /** 按 §13.6.3 重算的 hash。 */
  recomputedConfigHash: string;
  /**
   * hash 不一致时**只警告不阻塞**：文件被手工编辑过是常见且合理的操作
   * （策划用编辑器批量改种子），但必须让人知道这份文件不是原样导出的产物。
   */
  hashMismatch: boolean;
  /** §13.6.4：降级是合法操作，但必须让人看见。 */
  downgrades: VersionDowngrade[];
  resolution: ImportResolution;
  /** 只读的策略规则文本被强制拉回代码常量的记录。 */
  strategyOverrides: Array<{ mode: string; field: string }>;
  changeSummary: ChangeSummary;
  migration: MigrationReport | null;
  /** 通过确认后要提交的配置，已应用自动禁用。 */
  candidate: BehaviorConfigV2;
  /** 完整导出包附带的 Lab 运行时；提交时写入 Persona/Preset/Settings。 */
  labRuntime: LabRuntimeExport | null;
  labRuntimeSummary: {
    personaCount: number;
    promptPresetCount: number;
  } | null;
}

export interface ChangeSummary {
  canonFacts: AssetDelta;
  worldviewSeeds: AssetDelta;
  exampleCards: AssetDelta;
  /** 参数分组层面发生变化的键名。 */
  changedSettingGroups: string[];
}

export interface AssetDelta {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/**
 * 阶段一 + 阶段二。不写任何文件。
 *
 * `current` 是当前活动配置，用于算变更摘要与降级判定。
 */
export function prepareImport(
  raw: string,
  current: BehaviorConfigV2,
): ImportPreview {
  // ---- 阶段一：解析与判别 ----
  const detected = detectConfigFile(raw);
  const { candidate, migration, sourceProfileName } = buildCandidate(
    detected,
    current,
  );

  // 只读的行为规则文本一律取代码常量，不接受文件里的版本（§8.1 / D1）。
  const { policies, notes } = reconcileStrategyPolicies(candidate.strategies);
  const reconciled: BehaviorConfigV2 = { ...candidate, strategies: policies };

  // ---- 阶段二：校验与预览 ----
  const issues = validateBehaviorConfig(reconciled);
  const resolution = resolveForImport(issues);

  // 拒绝整包时仍然返回完整预览：只说「导入失败」而不说哪一条硬约束不满足，
  // 使用者无法修文件。抛异常会丢掉这些信息。
  const withDisabled = applyAutoDisable(reconciled, resolution.autoDisabled);
  const recomputedConfigHash = computeConfigHash(withDisabled);

  const declaredConfigHash =
    detected.generation === 2 && detected.kind === "mora_behavior_config"
      ? detected.payload.configHash
      : null;

  const labRuntime = extractLabRuntime(detected);

  return {
    kind: detected.generation === 1 ? "mora_behavior_config" : detected.kind,
    sourceGeneration: detected.generation,
    sourceProfileName,
    declaredConfigHash,
    recomputedConfigHash,
    // 单库与 v1 文件没有声明 hash，不存在「不一致」这回事。
    hashMismatch:
      declaredConfigHash !== null &&
      declaredConfigHash !== recomputedConfigHash,
    downgrades: detectVersionDowngrades(current, withDisabled),
    resolution,
    strategyOverrides: notes.map((note) => ({
      mode: note.mode,
      field: note.field,
    })),
    changeSummary: summarizeChanges(current, withDisabled),
    migration,
    candidate: { ...withDisabled, configHash: recomputedConfigHash },
    labRuntime,
    labRuntimeSummary: labRuntime
      ? {
          personaCount: labRuntime.personas.length,
          promptPresetCount: labRuntime.promptPresets.length,
        }
      : null,
  };
}

export interface CommitResult {
  config: BehaviorConfigV2;
  audit: ImportAudit;
}

/** §13.6.5 第 12 步的审计记录。 */
export interface ImportAudit {
  importedAt: string;
  sourceFileName: string;
  previousConfigHash: string;
  nextConfigHash: string;
  hashMismatch: boolean;
  autoDisabledCount: number;
  downgradedFields: string[];
}

/**
 * 阶段三的前半：把预览定稿成待写入的配置。
 *
 * 备份与原子写入由调用方（repository）负责——这个模块不该知道 store 的存在，
 * 否则测试导入逻辑必须先准备一整套数据目录。
 */
export function commitImport(
  preview: ImportPreview,
  current: BehaviorConfigV2,
  sourceFileName: string,
  now: Date = new Date(),
): CommitResult {
  if (preview.resolution.rejected) {
    throw new AppError(
      "VALIDATION_ERROR",
      `配置文件未通过硬约束校验，已拒绝整包导入：${preview.resolution.rejectionReasons
        .map((issue) => issue.message)
        .join("；")}`,
    );
  }

  // 提交前再校验一次结构：预览到提交之间隔着一次用户交互，中途可能
  // 因为代码更新而使得 schema 已经变化。
  const config = behaviorConfigV2Schema.parse(preview.candidate);

  return {
    config,
    audit: {
      importedAt: now.toISOString(),
      sourceFileName,
      previousConfigHash: current.configHash,
      nextConfigHash: config.configHash,
      hashMismatch: preview.hashMismatch,
      autoDisabledCount: preview.resolution.autoDisabled.length,
      downgradedFields: preview.downgrades.map((entry) => entry.field),
    },
  };
}

// ------------------------------------------------------------ 候选构造

function buildCandidate(
  detected: DetectedFile,
  current: BehaviorConfigV2,
): {
  candidate: BehaviorConfigV2;
  migration: MigrationReport | null;
  sourceProfileName: string;
} {
  if (detected.generation === 1) {
    const result = migrateV1ToV2(detected.bundle, current.sourceProfileName);
    return {
      candidate: result.config,
      migration: result.report,
      sourceProfileName: detected.bundle.sourceProfileName,
    };
  }

  if (detected.kind === "mora_behavior_config") {
    const { exportedAt: _exportedAt, labRuntime: _labRuntime, ...body } =
      detected.payload;

    return {
      // 导入后各 version 取「导入值」而不是 max（§13.6.4）：导入的语义是
      // 替换而非合并，取 max 会造出一个既不是旧配置也不是新配置的版本号。
      candidate: { ...body },
      migration: null,
      sourceProfileName: detected.payload.sourceProfileName,
    };
  }

  // 单库导入：只替换对应资产，其余保持活动配置不动。
  // 单库文件不含 version 与 hash，由接收端重算（§13.6.1）。
  if (detected.kind === "mora_worldview_library") {
    return {
      candidate: {
        ...current,
        canonFacts: detected.payload.canonFacts,
        worldviewSeeds: detected.payload.worldviewSeeds,
      },
      migration: null,
      sourceProfileName: detected.payload.sourceProfileName,
    };
  }

  return {
    candidate: {
      ...current,
      exampleCards: detected.payload.exampleCards,
    },
    migration: null,
    sourceProfileName: detected.payload.sourceProfileName,
  };
}

// ------------------------------------------------------------ 变更摘要

function summarizeChanges(
  current: BehaviorConfigV2,
  next: BehaviorConfigV2,
): ChangeSummary {
  return {
    canonFacts: diffAssets(current.canonFacts, next.canonFacts),
    worldviewSeeds: diffAssets(current.worldviewSeeds, next.worldviewSeeds),
    exampleCards: diffAssets(current.exampleCards, next.exampleCards),
    changedSettingGroups: (
      [
        "brandCanon",
        "router",
        "requestFlags",
        "energy",
        "majorEvent",
        "safety",
        "strategies",
        "worldview",
        "exampleRetrieval",
        "responseContract",
      ] as const
    ).filter(
      (key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]),
    ),
  };
}

/** 按 id 比对。资产 id 在导入时保留原值，所以 id 是可靠的对齐键（§13.6.5）。 */
function diffAssets<T extends { id: string }>(
  current: T[],
  next: T[],
): AssetDelta {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const nextIds = new Set(next.map((item) => item.id));

  let changed = 0;
  let unchanged = 0;
  let added = 0;

  for (const item of next) {
    const existing = currentById.get(item.id);
    if (!existing) {
      added += 1;
    } else if (JSON.stringify(existing) === JSON.stringify(item)) {
      unchanged += 1;
    } else {
      changed += 1;
    }
  }

  return {
    added,
    removed: current.filter((item) => !nextIds.has(item.id)).length,
    changed,
    unchanged,
  };
}

function extractLabRuntime(detected: DetectedFile): LabRuntimeExport | null {
  if (detected.generation === 1) {
    return {
      settings: detected.bundle.settings,
      personas: detected.bundle.personas,
      promptPresets: detected.bundle.promptPresets,
    };
  }
  if (detected.kind === "mora_behavior_config") {
    return detected.payload.labRuntime ?? null;
  }
  return null;
}
