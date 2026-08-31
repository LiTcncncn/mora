import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDefaultBehaviorConfig } from "@/domain/behavior-config";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { WorldviewSeed } from "@/domain/worldview-v2";
import { ensureBootstrapped } from "../persistence/bootstrap";
import { getDataDir } from "./env";
import { backupActiveConfig, listBackups, readBackup, MAX_BACKUPS } from "./behavior-backup";
import { computeConfigHash } from "./behavior-hash";
import { behaviorConfigRepository } from "./behavior-repository";
import { buildConfigExport, serializeExport } from "./behavior-transfer";

/**
 * §19.6.1 最后一条断言：**任一阶段失败后活动配置与 `data/` 下所有文件均未被
 * 修改**，用文件哈希断言而不只看返回值。
 *
 * 只看返回值是不够的——一次抛异常的导入完全可能已经写了半份文件，
 * 而返回值里看不出来。
 */

const PROFILE_ID = "profile-default";
const PROFILE_NAME = "默认档案";

beforeEach(async () => {
  await fs.rm(getDataDir(), { recursive: true, force: true });
  await fs.mkdir(getDataDir(), { recursive: true });
  await ensureBootstrapped().catch(() => undefined);
});

/** 对 data/ 下所有文件逐个取哈希，用于断言「一个字节都没动」。 */
async function snapshotDataDir(): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, key);
        continue;
      }
      const contents = await fs.readFile(full);
      result.set(key, createHash("sha256").update(contents).digest("hex"));
    }
  };

  await walk(getDataDir(), "");
  return result;
}

function seed(overrides: Partial<WorldviewSeed> = {}): WorldviewSeed {
  return {
    id: "seed-rain-001",
    title: "雨停之后",
    tags: ["rain"],
    triggerDescription: "用户描述连续阴雨提不起劲",
    memory: "雨季里有几天树冠一直在滴水。",
    attitude: "不急着让雨停。",
    allowedResponseModes: ["COMPANION"],
    energyFit: ["E1", "E2"],
    allowedModes: ["W1"],
    blockedMajorEventTypes: [],
    avoidClaims: [],
    cooldownGroup: "rain",
    canonFactIds: [],
    enabled: true,
    version: 1,
    ...overrides,
  };
}

function finalize(config: Omit<BehaviorConfigV2, "configHash">): BehaviorConfigV2 {
  return { ...config, configHash: computeConfigHash(config) };
}

async function saveBaseline(): Promise<BehaviorConfigV2> {
  const base = finalize({
    ...buildDefaultBehaviorConfig(PROFILE_NAME),
    worldviewSeeds: [seed()],
  });
  const { config } = await behaviorConfigRepository.save(
    PROFILE_ID,
    PROFILE_NAME,
    base,
  );
  return config;
}

describe("活动配置的读写", () => {
  it("首次读取返回默认配置且 hash 已回填", async () => {
    const config = await behaviorConfigRepository.get(PROFILE_ID, PROFILE_NAME);

    expect(config.schemaVersion).toBe(2);
    expect(config.configHash).toMatch(/^[\da-f]{16}$/);
    expect(config.configHash).toBe(computeConfigHash(config));
    // 首次读取不落库：默认值不该占一份存档，否则无法区分「没配过」与「配成默认」。
    expect(await behaviorConfigRepository.has(PROFILE_ID)).toBe(false);
  });

  it("保存时忽略传入的 hash 与 version，一律重算", async () => {
    const base = await saveBaseline();

    const tampered: BehaviorConfigV2 = {
      ...base,
      configHash: "ffffffffffffffff",
      worldviewVersion: "999",
      worldviewSeeds: [seed({ attitude: "改了。" })],
    };

    const { config, bumped } = await behaviorConfigRepository.save(
      PROFILE_ID,
      PROFILE_NAME,
      tampered,
    );

    expect(config.configHash).toBe(computeConfigHash(config));
    expect(config.configHash).not.toBe("ffffffffffffffff");
    // 自增基于**上一份存档**的值，不接受手填的 999（§13.6.4）。
    expect(config.worldviewVersion).toBe(
      String(Number(base.worldviewVersion) + 1),
    );
    expect(bumped).toEqual(["worldviewVersion"]);
  });

  it("硬约束违反时拒绝保存", async () => {
    const base = await saveBaseline();
    const broken: BehaviorConfigV2 = {
      ...base,
      energy: {
        ...base.energy,
        budgets: {
          ...base.energy.budgets,
          E2: { ...base.energy.budgets.E2, hardMaxChars: 10 },
        },
      },
    };

    await expect(
      behaviorConfigRepository.save(PROFILE_ID, PROFILE_NAME, broken),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("导入失败不改动任何文件", () => {
  it("硬约束违反的整包被拒绝，data/ 下所有文件逐字节未变", async () => {
    const base = await saveBaseline();
    const broken = structuredClone(base);
    broken.energy.budgets.E2.hardMaxChars = 10;

    const before = await snapshotDataDir();

    const preview = await behaviorConfigRepository.previewImport(
      PROFILE_ID,
      PROFILE_NAME,
      serializeExport(buildConfigExport(broken, new Date().toISOString())),
    );
    expect(preview.resolution.rejected).toBe(true);

    await expect(
      behaviorConfigRepository.commitImport(
        PROFILE_ID,
        PROFILE_NAME,
        preview,
        "broken.json",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await snapshotDataDir()).toEqual(before);
    // 备份也不该产生：备份是导入的一部分，失败的导入不留痕迹。
    expect(await listBackups()).toEqual([]);
  });

  it("预览阶段不写任何文件", async () => {
    await saveBaseline();
    const before = await snapshotDataDir();

    await behaviorConfigRepository.previewImport(
      PROFILE_ID,
      PROFILE_NAME,
      serializeExport(
        buildConfigExport(
          finalize(buildDefaultBehaviorConfig("别的档案")),
          new Date().toISOString(),
        ),
      ),
    );

    expect(await snapshotDataDir()).toEqual(before);
  });

  it("非法 JSON 在预览阶段就被拒绝且不写文件", async () => {
    await saveBaseline();
    const before = await snapshotDataDir();

    await expect(
      behaviorConfigRepository.previewImport(PROFILE_ID, PROFILE_NAME, "{ 坏文件"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await snapshotDataDir()).toEqual(before);
  });
});

describe("导入成功的提交", () => {
  it("提交前备份活动配置，备份可原样重新导入", async () => {
    const base = await saveBaseline();

    const incoming = structuredClone(base);
    incoming.worldviewSeeds = [seed({ attitude: "换个态度。" })];

    const preview = await behaviorConfigRepository.previewImport(
      PROFILE_ID,
      PROFILE_NAME,
      serializeExport(buildConfigExport(incoming, new Date().toISOString())),
    );
    const { config, audit, backup } = await behaviorConfigRepository.commitImport(
      PROFILE_ID,
      PROFILE_NAME,
      preview,
      "incoming.json",
    );

    expect(config.worldviewSeeds[0]!.attitude).toBe("换个态度。");
    expect(audit.previousConfigHash).toBe(base.configHash);
    expect(audit.nextConfigHash).toBe(config.configHash);
    expect(backup?.configHash).toBe(base.configHash);

    // 备份格式与正常导出完全一致，因此能直接走同一条导入流程（§13.6.9）。
    const restored = await behaviorConfigRepository.previewImport(
      PROFILE_ID,
      PROFILE_NAME,
      await readBackup(backup!.fileName),
    );
    expect(restored.resolution.rejected).toBe(false);
    expect(restored.candidate.configHash).toBe(base.configHash);
  });

  it("从未保存过的档案不产生备份", async () => {
    const incoming = finalize(buildDefaultBehaviorConfig(PROFILE_NAME));

    const preview = await behaviorConfigRepository.previewImport(
      PROFILE_ID,
      PROFILE_NAME,
      serializeExport(buildConfigExport(incoming, new Date().toISOString())),
    );
    const { backup } = await behaviorConfigRepository.commitImport(
      PROFILE_ID,
      PROFILE_NAME,
      preview,
      "incoming.json",
    );

    // 备份一份默认值只会占掉保留额度，且恢复它等于没恢复。
    expect(backup).toBeNull();
  });
});

describe("备份保留策略", () => {
  it("只保留最近 20 份，超出时删除最旧的", async () => {
    const base = finalize(buildDefaultBehaviorConfig(PROFILE_NAME));

    // 时间戳进文件名，必须给出不同的时刻，否则会互相覆盖。
    for (let index = 0; index < MAX_BACKUPS + 5; index += 1) {
      const config = finalize({
        ...base,
        worldviewSeeds: [seed({ attitude: `第 ${index} 版` })],
      });
      await backupActiveConfig(
        config,
        new Date(Date.UTC(2026, 7, 31, 12, index, 0)),
      );
    }

    const backups = await listBackups();
    expect(backups).toHaveLength(MAX_BACKUPS);
    // 倒序列出，最新在前；被删掉的是最旧的五份。
    expect(backups[0]!.fileName).toContain("2026-08-31T12-24");
    expect(backups.at(-1)!.fileName).toContain("2026-08-31T12-05");
  });

  it("拒绝不合法的备份文件名，不拼接任意路径", async () => {
    await expect(readBackup("../../etc/passwd")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(readBackup("whatever.json")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
