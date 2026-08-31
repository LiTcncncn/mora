import { describe, expect, it } from "vitest";
import {
  behaviorConfigV2Schema,
  buildDefaultBehaviorConfig,
  type BehaviorConfigV2,
} from "@/domain/behavior-config";
import type { BehaviorExampleCard } from "@/domain/behavior-example";
import type { WorldviewCanonFact, WorldviewSeed } from "@/domain/worldview-v2";
import { computeConfigHash } from "./behavior-hash";
import { prepareImport, commitImport } from "./behavior-import";
import {
  buildConfigExport,
  buildExampleLibraryExport,
  buildExportFileName,
  buildWorldviewLibraryExport,
  detectConfigFile,
  serializeExport,
} from "./behavior-transfer";
import { bumpChangedVersions } from "./behavior-versions";
import {
  resolveForImport,
  resolveForSave,
  validateBehaviorConfig,
} from "./behavior-validate";

/**
 * §19.6.1 的六组断言。
 *
 * 往返丢字段是这类功能最常见的缺陷，且一旦发生就是静默的数据损失——
 * 没有任何报错，只是某个字段在下一次导出时消失了。
 */

const EXPORTED_AT = "2026-08-31T12:00:00.000Z";

function fact(overrides: Partial<WorldviewCanonFact> = {}): WorldviewCanonFact {
  return {
    id: "fact-origin-tree",
    category: "origin",
    content: "MORA 出生在雨林深处的一棵树上。",
    aliases: ["出生树", "你在哪出生"],
    enabled: true,
    version: 1,
    ...overrides,
  };
}

function seed(overrides: Partial<WorldviewSeed> = {}): WorldviewSeed {
  return {
    id: "seed-rain-001",
    title: "雨停之后",
    tags: ["rain"],
    triggerDescription: "用户描述连续阴雨提不起劲",
    memory: "雨季里有几天树冠一直在滴水，什么都不想做。",
    attitude: "不急着让雨停，等它自己停。",
    allowedResponseModes: ["COMPANION"],
    energyFit: ["E1", "E2"],
    allowedModes: ["W1"],
    blockedMajorEventTypes: [],
    avoidClaims: [],
    cooldownGroup: "rain",
    canonFactIds: ["fact-origin-tree"],
    enabled: true,
    version: 1,
    ...overrides,
  };
}

function card(overrides: Partial<BehaviorExampleCard> = {}): BehaviorExampleCard {
  return {
    id: "card-companion-001",
    name: "疲惫不想动",
    responseMode: "COMPANION",
    energyRange: ["E1", "E2"],
    questionPreferences: ["neutral"],
    majorEventCompatible: false,
    majorEventTypes: [],
    topicTags: ["累"],
    user: "好累，什么都不想干。",
    idealReply: "那就先这样待着呗，又不是比赛。",
    demonstrates: ["不追问原因"],
    evaluatorWarnings: [],
    reviewStatus: "approved",
    enabled: true,
    version: 1,
    ...overrides,
  };
}

function baseConfig(overrides: Partial<BehaviorConfigV2> = {}): BehaviorConfigV2 {
  const defaults = buildDefaultBehaviorConfig("默认档案");
  const withAssets = {
    ...defaults,
    canonFacts: [fact()],
    worldviewSeeds: [seed()],
    exampleCards: [card()],
    ...overrides,
  };
  return { ...withAssets, configHash: computeConfigHash(withAssets) };
}

// ------------------------------------------------------------ 往返等价性

describe("往返等价性", () => {
  it("导出 → 导入 → 再导出，两份文件除 exportedAt 外逐字节相同", () => {
    const config = baseConfig();

    const first = serializeExport(buildConfigExport(config, EXPORTED_AT));
    const preview = prepareImport(first, config);
    const { config: imported } = commitImport(preview, config, "first.json");

    const second = serializeExport(
      buildConfigExport(imported, "2026-09-01T00:00:00.000Z"),
    );

    const strip = (text: string) =>
      text.replace(/"exportedAt": "[^"]+"/, '"exportedAt": "<stripped>"');
    expect(strip(second)).toBe(strip(first));
  });

  it("往返后 configHash 不变", () => {
    const config = baseConfig();
    const preview = prepareImport(
      serializeExport(buildConfigExport(config, EXPORTED_AT)),
      config,
    );

    expect(preview.recomputedConfigHash).toBe(config.configHash);
    expect(preview.hashMismatch).toBe(false);
  });

  it("往返后三类内容资产的 id 全部保留原值", () => {
    const config = baseConfig();
    const preview = prepareImport(
      serializeExport(buildConfigExport(config, EXPORTED_AT)),
      config,
    );

    expect(preview.candidate.canonFacts.map((item) => item.id)).toEqual([
      "fact-origin-tree",
    ]);
    expect(preview.candidate.worldviewSeeds.map((item) => item.id)).toEqual([
      "seed-rain-001",
    ]);
    expect(preview.candidate.exampleCards.map((item) => item.id)).toEqual([
      "card-companion-001",
    ]);
  });

  it("往返后软删除记录仍在包内且状态不变", () => {
    // 软删除的记录纳入 hash（§13.6.3）：它们仍在配置里，且启停状态直接影响行为。
    const config = baseConfig({
      worldviewSeeds: [seed(), seed({ id: "seed-old-002", enabled: false })],
    });
    const finalized = { ...config, configHash: computeConfigHash(config) };

    const preview = prepareImport(
      serializeExport(buildConfigExport(finalized, EXPORTED_AT)),
      finalized,
    );

    const restored = preview.candidate.worldviewSeeds.find(
      (item) => item.id === "seed-old-002",
    );
    expect(restored).toBeDefined();
    expect(restored?.enabled).toBe(false);
  });

  it("单库往返后的资产内容与主配置往返一致", () => {
    const config = baseConfig();

    const worldviewFile = serializeExport(
      buildWorldviewLibraryExport(config, EXPORTED_AT),
    );
    const exampleFile = serializeExport(
      buildExampleLibraryExport(config, EXPORTED_AT),
    );

    // 从一份空资产的配置出发，两次单库导入应还原出相同的资产。
    const empty = baseConfig({
      canonFacts: [],
      worldviewSeeds: [],
      exampleCards: [],
    });

    const afterWorldview = commitImport(
      prepareImport(worldviewFile, empty),
      empty,
      "worldview.json",
    ).config;
    const afterExamples = commitImport(
      prepareImport(exampleFile, afterWorldview),
      afterWorldview,
      "examples.json",
    ).config;

    expect(afterExamples.canonFacts).toEqual(config.canonFacts);
    expect(afterExamples.worldviewSeeds).toEqual(config.worldviewSeeds);
    expect(afterExamples.exampleCards).toEqual(config.exampleCards);
  });

  it("单库文件不含 configHash 与五个 version", () => {
    const config = baseConfig();
    const parsed = JSON.parse(
      serializeExport(buildWorldviewLibraryExport(config, EXPORTED_AT)),
    ) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("configHash");
    expect(parsed).not.toHaveProperty("worldviewVersion");
    expect(Object.keys(parsed).sort()).toEqual([
      "canonFacts",
      "exportedAt",
      "kind",
      "schemaVersion",
      "sourceProfileName",
      "worldviewSeeds",
    ]);
  });
});

// ------------------------------------------------------------ configHash

describe("configHash", () => {
  it("固定输入产出固定 hash", () => {
    // 写死期望值以防实现漂移（与 §9.5.4 的 FNV-1a 同样处理）。
    // 改动 §13.6.3 的计算方式时，这条断言必须连同理由一起更新。
    expect(computeConfigHash(baseConfig())).toBe("791fcedc61f751d8");
  });

  it("hash 长度固定为 16 个十六进制字符", () => {
    expect(computeConfigHash(baseConfig())).toMatch(/^[\da-f]{16}$/);
  });

  it("改动任一颗种子的 attitude 使 hash 变化", () => {
    // 这条验证 hash 真的覆盖了三类资产。若不覆盖，策划改一颗种子后
    // configHash 不变而行为已变，§9.5.5 的用途就失效。
    const before = computeConfigHash(baseConfig());
    const after = computeConfigHash(
      baseConfig({ worldviewSeeds: [seed({ attitude: "换一个态度。" })] }),
    );

    expect(after).not.toBe(before);
  });

  it("改动 Canon Fact 或示例卡使 hash 变化", () => {
    const before = computeConfigHash(baseConfig());

    expect(
      computeConfigHash(baseConfig({ canonFacts: [fact({ content: "改了。" })] })),
    ).not.toBe(before);
    expect(
      computeConfigHash(baseConfig({ exampleCards: [card({ idealReply: "改了。" })] })),
    ).not.toBe(before);
  });

  it("改动 exportedAt 或 sourceProfileName 不影响 hash", () => {
    const config = baseConfig();

    // exportedAt 不在活动配置里，改 sourceProfileName 即可覆盖同一条要求：
    // 同一份配置连续导出两次必须得到相同 hash。
    const renamed: BehaviorConfigV2 = {
      ...config,
      sourceProfileName: "另一个档案",
    };

    expect(computeConfigHash(renamed)).toBe(computeConfigHash(config));
  });

  it("改动任一 version 字段不影响 hash", () => {
    const config = baseConfig();
    const bumpedWorldview: BehaviorConfigV2 = { ...config, worldviewVersion: "99" };
    const bumpedTaxonomy: BehaviorConfigV2 = { ...config, taxonomyVersion: "42" };

    expect(computeConfigHash(bumpedWorldview)).toBe(computeConfigHash(config));
    expect(computeConfigHash(bumpedTaxonomy)).toBe(computeConfigHash(config));
  });

  it("对象键顺序不同但内容相同的两份配置 hash 相同", () => {
    const config = baseConfig();

    // 按插入顺序倒序重建每一层对象。这是 §13.6.3 要求「不依赖 JS 对象插入
    // 顺序」的直接检验：同样的内容换个键序必须得到同一个 hash，否则
    // 编辑器保存时重排了字段就会显示成一次配置变更。
    const reversed = reverseKeyOrder(config) as BehaviorConfigV2;

    expect(Object.keys(reversed)).not.toEqual(Object.keys(config));
    expect(computeConfigHash(reversed)).toBe(computeConfigHash(config));
  });

  it("数组顺序不同则 hash 不同", () => {
    // 种子顺序不影响行为，但排序会掩盖「顺序被意外改动」这类问题（§13.6.3）。
    const a = baseConfig({
      worldviewSeeds: [seed(), seed({ id: "seed-b", cooldownGroup: "river" })],
    });
    const b = baseConfig({
      worldviewSeeds: [seed({ id: "seed-b", cooldownGroup: "river" }), seed()],
    });

    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });

  it("把一条记录从 enabled=true 改为 false 使 hash 变化", () => {
    expect(
      computeConfigHash(baseConfig({ exampleCards: [card({ enabled: false })] })),
    ).not.toBe(computeConfigHash(baseConfig()));
  });
});

// ------------------------------------------------------------ 判别与拒绝

describe("判别与拒绝", () => {
  it("schemaVersion 1 走迁移器，schemaVersion 2 走直接导入", () => {
    const v2 = serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT));
    expect(detectConfigFile(v2).generation).toBe(2);

    const v1 = JSON.stringify(v1Bundle());
    expect(detectConfigFile(v1).generation).toBe(1);
  });

  it("schemaVersion 3 被拒绝并提示来自更新版本", () => {
    expect(() =>
      detectConfigFile(JSON.stringify({ schemaVersion: 3, kind: "x" })),
    ).toThrow(/更新版本/);
  });

  it("JSON 非法、缺少 schemaVersion、kind 不识别三种拒绝各有明确提示", () => {
    expect(() => detectConfigFile("{ not json")).toThrow(/不是合法 JSON/);
    expect(() => detectConfigFile(JSON.stringify({ kind: "x" }))).toThrow(
      /无法识别的配置文件/,
    );
    expect(() =>
      detectConfigFile(JSON.stringify({ schemaVersion: 2, kind: "mora_unknown" })),
    ).toThrow(/无法识别的文件类型/);
  });

  it("含未知字段的 v2 文件被严格模式拒绝", () => {
    const payload = JSON.parse(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
    ) as Record<string, unknown>;
    payload.smuggledField = "应当被拒绝";

    expect(() => detectConfigFile(JSON.stringify(payload))).toThrow(
      /结构校验失败/,
    );
  });

  it("v1 包 fewShotSamples 缺失与显式空数组的行为可区分", () => {
    const config = baseConfig();

    const absent = prepareImport(JSON.stringify(v1Bundle()), config);
    expect(absent.migration?.fewShotSource).toBe("absent");
    expect(absent.migration?.exampleCardCandidates).toBe(0);
    expect(absent.migration?.notes.join("\n")).toMatch(/不管样本/);

    const explicitEmpty = prepareImport(
      JSON.stringify({ ...v1Bundle(), fewShotSamples: [] }),
      config,
    );
    expect(explicitEmpty.migration?.fewShotSource).toBe("explicit_empty");
    expect(explicitEmpty.migration?.exampleCardCandidates).toBe(0);
    expect(explicitEmpty.migration?.notes.join("\n")).toMatch(/显式清空/);

    // 两者都生成零张卡，因此必须靠 fewShotSource 区分而不是靠卡片数量。
    expect(absent.migration?.fewShotSource).not.toBe(
      explicitEmpty.migration?.fewShotSource,
    );
  });

  it("v1 迁移出的示例卡全部为待审核且未启用", () => {
    const preview = prepareImport(
      JSON.stringify({
        ...v1Bundle(),
        fewShotSamples: [v1Sample()],
      }),
      baseConfig(),
    );

    expect(preview.migration?.exampleCardCandidates).toBe(1);
    const migrated = preview.candidate.exampleCards[0]!;
    expect(migrated.reviewStatus).toBe("pending");
    expect(migrated.enabled).toBe(false);
    expect(migrated.id).toBe("fs-0001");
  });

  it("v1 迁移把含世界观的样本列为待拆种子", () => {
    const preview = prepareImport(
      JSON.stringify({
        ...v1Bundle(),
        fewShotSamples: [v1Sample({ id: "fs-0004", worldview: "L2" })],
      }),
      baseConfig(),
    );

    expect(preview.migration?.seedCandidatesPending).toEqual([
      { sourceSampleId: "fs-0004", scene: "疲惫不想动" },
    ]);
  });
});

// ------------------------------------------------------------ 校验路径差异

describe("校验路径差异", () => {
  it("硬约束违反时拒绝整包，且不产出可提交的配置", () => {
    const broken = baseConfig();
    broken.energy.budgets.E2.hardMaxChars = 10;

    const preview = prepareImport(
      serializeExport(buildConfigExport(broken, EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.resolution.rejected).toBe(true);
    expect(preview.resolution.rejectionReasons.map((issue) => issue.code)).toContain(
      "energy.hard_below_target",
    );
    // 拒绝整包时 commitImport 必须抛错，不允许「导入能导的部分」。
    expect(() =>
      commitImport(preview, baseConfig(), "broken.json"),
    ).toThrow(/拒绝整包导入/);
  });

  it("含一颗死种子时导入成功，该种子被自动禁用，其余正常", () => {
    // CLOSE 的 allowWorldview=false，只标 CLOSE 的种子永远选不中（D56）。
    const withDeadSeed = baseConfig({
      worldviewSeeds: [
        seed(),
        seed({
          id: "seed-dead",
          allowedResponseModes: ["CLOSE"],
          cooldownGroup: "close",
        }),
      ],
    });

    const preview = prepareImport(
      serializeExport(buildConfigExport(withDeadSeed, EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.resolution.rejected).toBe(false);
    expect(preview.resolution.autoDisabled.map((entry) => entry.target.id)).toEqual(
      ["seed-dead"],
    );
    expect(preview.resolution.autoDisabled[0]!.reason).toMatch(/永远不会被选中/);

    const seeds = preview.candidate.worldviewSeeds;
    expect(seeds.find((item) => item.id === "seed-dead")?.enabled).toBe(false);
    expect(seeds.find((item) => item.id === "seed-rain-001")?.enabled).toBe(true);
  });

  it("引用了不存在 Canon Fact 的种子被导入并禁用", () => {
    const withBadRef = baseConfig({
      worldviewSeeds: [seed({ canonFactIds: ["fact-does-not-exist"] })],
    });

    const preview = prepareImport(
      serializeExport(buildConfigExport(withBadRef, EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.resolution.rejected).toBe(false);
    expect(preview.candidate.worldviewSeeds[0]!.enabled).toBe(false);
  });

  it("命中 canon lint 禁词的记录被导入并禁用，不拒绝整包", () => {
    const withForbidden = baseConfig({
      worldviewSeeds: [
        seed({ memory: "那天在沙滩上待了很久。", canonFactIds: [] }),
      ],
    });

    const preview = prepareImport(
      serializeExport(buildConfigExport(withForbidden, EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.resolution.rejected).toBe(false);
    expect(preview.candidate.worldviewSeeds[0]!.enabled).toBe(false);
    expect(
      preview.resolution.autoDisabled.some((entry) =>
        entry.reason.includes("沙滩"),
      ),
    ).toBe(true);
  });

  it("禁词表自身不被 canon lint 判为违规", () => {
    // 禁词表列出这些词是它的职责。把它当成违规内容会让任何配置都无法保存。
    const issues = validateBehaviorConfig(
      baseConfig({ canonFacts: [], worldviewSeeds: [], exampleCards: [] }),
    );

    expect(issues.filter((issue) => issue.category === "forbidden_term")).toEqual(
      [],
    );
  });

  it("软约束警告不阻塞导入", () => {
    // 默认配置只有一张示例卡，必然未达 §11.6 门槛。
    const preview = prepareImport(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.resolution.rejected).toBe(false);
    expect(preview.resolution.warnings.map((issue) => issue.code)).toContain(
      "example.below_threshold",
    );
  });

  it("同一份问题在保存路径上的处置比导入路径更严", () => {
    const withForbidden = baseConfig({
      worldviewSeeds: [seed({ memory: "海龟慢慢爬过。", canonFactIds: [] })],
    });
    const issues = validateBehaviorConfig(withForbidden);

    // 禁词：保存拒绝、导入禁用该条（§13.6.6）。
    expect(resolveForSave(issues).ok).toBe(false);
    expect(resolveForImport(issues).rejected).toBe(false);
  });

  it("死种子在保存路径上只警告并阻塞启用，不拒绝保存", () => {
    const issues = validateBehaviorConfig(
      baseConfig({
        worldviewSeeds: [seed({ allowedResponseModes: ["CLOSE"] })],
      }),
    );
    const resolution = resolveForSave(issues);

    expect(resolution.ok).toBe(true);
    expect(resolution.blockedFromEnabling.map((ref) => ref.id)).toContain(
      "seed-rain-001",
    );
  });

  it("allowInviteOverride 违规被判为硬约束", () => {
    const config = baseConfig();
    config.strategies.CLOSE.allowInviteOverride = true;

    const issues = validateBehaviorConfig(config);
    expect(issues.map((issue) => issue.code)).toContain(
      "strategy.invite_override_forbidden",
    );
    expect(resolveForSave(issues).ok).toBe(false);
    expect(resolveForImport(issues).rejected).toBe(true);
  });

  it("已废弃键名被指名拒绝", () => {
    const payload = JSON.parse(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
    ) as { worldview: Record<string, unknown> };
    payload.worldview.minOrganicGap = 2;

    // 报错必须指名键名：这类文件几乎都来自手工把 v1 配置改成 v2，
    // 「未知字段」不足以让人知道该改哪里。
    expect(() => detectConfigFile(JSON.stringify(payload))).toThrow(
      /已废弃的键名 minOrganicGap/,
    );
  });

  it("嵌套层的未知字段不被静默剥掉", () => {
    const payload = JSON.parse(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
    ) as { worldview: Record<string, unknown> };
    payload.worldview.somethingNew = true;

    expect(() => detectConfigFile(JSON.stringify(payload))).toThrow(
      /结构校验失败/,
    );
  });

  it("导入文件里的只读策略文本被强制拉回代码常量", () => {
    const tampered = baseConfig();
    tampered.strategies.CLOSE.goal = "偷偷改掉行为规则。";
    tampered.strategies.CLOSE.mustAvoid = [];

    const preview = prepareImport(
      serializeExport(buildConfigExport(tampered, EXPORTED_AT)),
      baseConfig(),
    );

    expect(preview.candidate.strategies.CLOSE.goal).toBe("允许对话自然结束。");
    expect(preview.candidate.strategies.CLOSE.mustAvoid).toContain("追加问题");
    expect(preview.strategyOverrides).toEqual(
      expect.arrayContaining([
        { mode: "CLOSE", field: "goal" },
        { mode: "CLOSE", field: "mustAvoid" },
      ]),
    );
  });

  it("手工编辑过的文件 hash 不一致时只警告不阻塞", () => {
    const payload = JSON.parse(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
    ) as Record<string, unknown>;
    payload.configHash = "0000000000000000";

    const preview = prepareImport(JSON.stringify(payload), baseConfig());

    expect(preview.hashMismatch).toBe(true);
    expect(preview.resolution.rejected).toBe(false);
  });
});

// ------------------------------------------------------------ 降级与版本

describe("降级与版本", () => {
  it("导入 worldviewVersion 低于当前值时不拒绝，预览标出降级字段", () => {
    const current = { ...baseConfig(), worldviewVersion: "5" };
    const incoming = baseConfig({ worldviewVersion: "2" });

    const preview = prepareImport(
      serializeExport(buildConfigExport(incoming, EXPORTED_AT)),
      current,
    );

    expect(preview.resolution.rejected).toBe(false);
    expect(preview.downgrades).toEqual([
      { field: "worldviewVersion", from: "5", to: "2" },
    ]);
  });

  it("导入后各 version 取导入值而非 max", () => {
    // 取 max 会造出一个既不是旧配置也不是新配置的版本号（§13.6.4）。
    const current = { ...baseConfig(), worldviewVersion: "5" };
    const incoming = baseConfig({ worldviewVersion: "2" });

    const preview = prepareImport(
      serializeExport(buildConfigExport(incoming, EXPORTED_AT)),
      current,
    );

    expect(preview.candidate.worldviewVersion).toBe("2");
  });

  it("保存时同时改动 energy 与 strategies，两个 version 各自自增，其余不变", () => {
    const previous = baseConfig();
    const next = baseConfig();
    next.energy.budgets.E3.targetMaxChars = 400;
    next.strategies.COMPANION.lengthMultiplier = 0.9;

    const { config, bumped } = bumpChangedVersions(previous, next);

    expect(bumped.sort()).toEqual(["energyPolicyVersion", "strategyPolicyVersion"]);
    expect(config.energyPolicyVersion).toBe("2");
    expect(config.strategyPolicyVersion).toBe("2");
    expect(config.worldviewVersion).toBe("1");
    expect(config.exampleLibraryVersion).toBe("1");
    expect(config.taxonomyVersion).toBe("1");
  });

  it("worldviewVersion 覆盖调度参数与两类世界观资产", () => {
    const previous = baseConfig();

    for (const mutate of [
      (config: BehaviorConfigV2) => {
        config.worldview.seedCooldownTurns = 8;
      },
      (config: BehaviorConfigV2) => {
        config.canonFacts = [fact({ content: "改了。" })];
      },
      (config: BehaviorConfigV2) => {
        config.worldviewSeeds = [seed({ attitude: "改了。" })];
      },
    ]) {
      const next = baseConfig();
      mutate(next);
      expect(bumpChangedVersions(previous, next).bumped).toEqual([
        "worldviewVersion",
      ]);
    }
  });

  it("exampleLibraryVersion 覆盖检索参数与示例卡", () => {
    const previous = baseConfig();
    const next = baseConfig({ exampleCards: [card({ idealReply: "改了。" })] });

    expect(bumpChangedVersions(previous, next).bumped).toEqual([
      "exampleLibraryVersion",
    ]);
  });

  it("未改动任何范围时不自增任何 version", () => {
    const previous = baseConfig();
    expect(bumpChangedVersions(previous, baseConfig()).bumped).toEqual([]);
  });
});

// ------------------------------------------------------------ 排除清单

describe("排除清单", () => {
  it("导出文件不含凭据、用户数据与历史事实", () => {
    const text = serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT));

    for (const forbidden of [
      "apiKey",
      "API_KEY",
      "profileId",
      "eventFingerprint",
      "event-fingerprints",
      "strategyProposal",
      "strategy-proposals",
      "WorldviewScheduleState",
      "scheduleSeed",
      "rollingOutcomes",
      "recentSeedIds",
      "conversation",
      "messages",
      "memories",
      "runs",
      "contextSnapshot",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("白名单序列化：活动配置上多出的字段不进导出文件", () => {
    // 这条验证的是排除方式，不是排除结果。黑名单删除在新增字段时会默认
    // 泄露，白名单在新增字段时默认不导出——只有后者的失败方向是安全的。
    const polluted = {
      ...baseConfig(),
      smuggledUserData: { scheduleSeed: "abc", credit: 2 },
    } as unknown as BehaviorConfigV2;

    const text = serializeExport(buildConfigExport(polluted, EXPORTED_AT));

    expect(text).not.toContain("smuggledUserData");
    expect(text).not.toContain("scheduleSeed");
  });

  it("导出文件通过 v2 严格校验，说明没有多余字段", () => {
    const parsed = JSON.parse(
      serializeExport(buildConfigExport(baseConfig(), EXPORTED_AT)),
    ) as Record<string, unknown>;
    const { exportedAt: _exportedAt, ...body } = parsed;

    expect(behaviorConfigV2Schema.safeParse(body).success).toBe(true);
  });
});

// ------------------------------------------------------------ 文件形态

describe("导出文件形态", () => {
  it("2 空格缩进且键序稳定，便于进 git diff", () => {
    const config = baseConfig();
    const first = serializeExport(buildConfigExport(config, EXPORTED_AT));
    const second = serializeExport(buildConfigExport(config, EXPORTED_AT));

    expect(first).toBe(second);
    expect(first).toContain('\n  "brandCanon": {');
    // 键序稳定即字典序：canonFacts 必须排在 configHash 之前。
    expect(first.indexOf('"canonFacts"')).toBeLessThan(
      first.indexOf('"configHash"'),
    );
  });

  it("文件名带 hash 前 8 位，便于不打开文件判断两份导出是否相同", () => {
    const name = buildExportFileName(
      "mora_behavior_config",
      "默认档案",
      "53ba32e9d15c4dd0",
      new Date(EXPORTED_AT),
    );

    expect(name).toBe("mora-config-默认档案-2026-08-31-53ba32e9.json");
  });

  it("文件名清掉路径分隔符与空格", () => {
    const name = buildExportFileName(
      "mora_worldview_library",
      "a/b c:d",
      "0123456789abcdef",
      new Date(EXPORTED_AT),
    );

    expect(name).toBe("mora-worldview-a-b-c-d-2026-08-31-01234567.json");
    expect(name).not.toMatch(/[/\\:\s]/);
  });
});

/** 递归倒转对象键的插入顺序；数组顺序保持不动。 */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).reverse()) {
    result[key] = reverseKeyOrder(source[key]);
  }
  return result;
}

// ------------------------------------------------------------ v1 夹具

function v1Sample(overrides: Record<string, unknown> = {}) {
  return {
    id: "fs-0001",
    profileId: "profile-default",
    scene: "疲惫不想动",
    energy: "E0",
    worldview: "none",
    keywords: ["累"],
    user: "好累，什么都不想干。",
    reply: "躺一下午也行啊。",
    note: "去掉咨询腔。",
    enabled: true,
    createdAt: "2026-08-28T15:00:00.000Z",
    updatedAt: "2026-08-28T15:00:00.000Z",
    ...overrides,
  };
}

/** 最小可用的 v1 包。字段取自 `src/domain/config-bundle.ts`。 */
function v1Bundle() {
  return {
    schemaVersion: 1,
    kind: "mora_behavior_config",
    exportedAt: "2026-08-28T15:00:00.000Z",
    sourceProfileName: "旧档案",
    settings: v1Settings(),
    personas: [],
    promptPresets: [],
  };
}

function v1Settings() {
  const provider = {
    enabled: true,
    modelId: "kimi-k2",
    generation: {
      temperature: 0.7,
      topP: null,
      maxOutputTokens: 1000,
      presencePenalty: null,
      frequencyPenalty: null,
      seed: null,
      thinkingMode: null,
      reasoningEffort: null,
      verbosity: null,
    },
    transport: { timeoutMs: 60_000, maxRetries: 2, stream: false as const },
    pricing: {
      currency: "USD" as const,
      inputPerMillion: null,
      cachedInputPerMillion: null,
      outputPerMillion: null,
      label: "",
      effectiveDate: null,
    },
  };

  const policy = (targetMaxChars: number, sentences: number) => ({
    targetMaxChars,
    targetMaxSentences: sentences,
    maxQuestions: 1,
    maxSuggestedActions: 1,
    allowAdvice: true,
    validationWeight: 0.5,
    actionWeight: 0.5,
    toneInstruction: "旧的语气说明",
    responseInstruction: "旧的回复说明",
  });

  return {
    activePersonaId: "persona-default",
    activePromptPresetId: "preset-default",
    defaultProvider: "kimi" as const,
    providers: { kimi: provider, deepseek: provider },
    energy: {
      mode: "hybrid" as const,
      manualLevel: "E2" as const,
      allowPerMessageOverride: true,
      llmClassifier: { provider: "deepseek" as const, modelId: "deepseek-v4-flash" },
      ruleBased: {
        enabled: true,
        lowEnergyKeywords: ["累"],
        highEnergyKeywords: ["想聊"],
        exhaustionPunctuationWeight: 0.3,
        shortMessageThreshold: 12,
      },
      policies: {
        E0: policy(100, 2),
        E1: policy(140, 3),
        E2: policy(220, 5),
        E3: policy(420, 8),
      },
    },
    memory: {
      enabled: true,
      topK: 5,
      maxChars: 1200,
      minImportance: 0.3,
      includedTypes: [],
      weights: {
        pinned: 0.4,
        importance: 0.3,
        recency: 0.2,
        keywordRelevance: 0.1,
      },
      autoCandidateExtraction: {
        enabled: false,
        provider: "deepseek" as const,
        modelId: "deepseek-v4-flash",
        requireManualApproval: true,
      },
    },
    context: {
      historyTurns: 8,
      maxHistoryChars: 6000,
      maxTotalChars: 12_000,
      includeTimestamps: false,
      includeEnergyReason: true,
      includeMemoryMetadata: false,
      sectionOrder: [],
      customExperimentBlockEnabled: false,
      fewShot: {
        enabled: true,
        maxPerLevel: { E0: 1, E1: 2, E2: 2, E3: 3 },
        maxWorldviewPerTurn: 1,
        maxChars: 1500,
        minScore: 0.35,
      },
    },
    logging: {
      saveContextSnapshot: true,
      saveSettingsSnapshot: true,
      saveStandardizedProviderResponse: true,
      saveRawProviderResponse: false,
      maxRuns: 500,
    },
    evaluation: { enabled: false as const, autoEvaluatorEnabled: false as const },
    compare: {
      runInParallel: true as const,
      historyMode: "independent_lanes" as const,
      modelSlots: [
        {
          id: "slot-a",
          label: "A",
          enabled: true,
          provider: "kimi" as const,
          modelId: "kimi-k2",
          generationOverrides: {},
        },
      ],
    },
  };
}
