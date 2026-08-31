import "server-only";
import {
  behaviorConfigStoreDataSchema,
  buildDefaultBehaviorConfig,
  type BehaviorConfigV2,
} from "@/domain/behavior-config";
import { AppError } from "../api/errors";
import { JsonStore } from "../persistence/atomic-json-store";
import { backupActiveConfig } from "./behavior-backup";
import { computeConfigHash } from "./behavior-hash";
import { commitImport, prepareImport, type ImportPreview } from "./behavior-import";
import {
  bumpChangedVersions,
  type ConfigVersionField,
} from "./behavior-versions";
import {
  resolveForSave,
  validateBehaviorConfig,
  type SaveResolution,
} from "./behavior-validate";

/**
 * 活动 Behavior Config v2 的读写。
 *
 * 保存路径的三件事——校验、version 自增、hash 回填——必须收在这一处。
 * 分散到各个 API 入口去做，就会出现某个入口忘了自增版本或忘了重算 hash，
 * 而这两个字段一旦失真，§9.5.5「用 configHash 解释行为突变」就不再可用。
 */

export const behaviorConfigStore = new JsonStore(
  "behavior-config",
  behaviorConfigStoreDataSchema,
);

/** 补上 configHash：domain 层不引入 node:crypto，默认配置出厂时没有 hash。 */
function finalize(config: Omit<BehaviorConfigV2, "configHash">): BehaviorConfigV2 {
  return { ...config, configHash: computeConfigHash(config) };
}

export const behaviorConfigRepository = {
  /** 首次读取时用默认值补齐，不要求 Phase 0 手工建档。 */
  async get(
    profileId: string,
    profileName: string,
  ): Promise<BehaviorConfigV2> {
    const data = await behaviorConfigStore.read();
    const entry = data.items.find((item) => item.profileId === profileId);
    if (entry) return entry.config;

    return finalize(buildDefaultBehaviorConfig(profileName));
  },

  async has(profileId: string): Promise<boolean> {
    const data = await behaviorConfigStore.read();
    return data.items.some((item) => item.profileId === profileId);
  },

  /**
   * 保存路径（§13.6.6 左列）：硬约束与禁词直接拒绝。
   *
   * 传入的 `next` 里的五个 version 与 configHash 一律被忽略并重算——
   * 它们由系统自增，不可手填（§13.6.4）。
   */
  async save(
    profileId: string,
    profileName: string,
    next: BehaviorConfigV2,
  ): Promise<{ config: BehaviorConfigV2; resolution: SaveResolution; bumped: ConfigVersionField[] }> {
    const previous = await this.get(profileId, profileName);

    const resolution = resolveForSave(validateBehaviorConfig(next));
    if (!resolution.ok) {
      throw new AppError(
        "VALIDATION_ERROR",
        `配置校验未通过：${resolution.blocking.map((issue) => issue.message).join("；")}`,
      );
    }

    const { config: versioned, bumped } = bumpChangedVersions(previous, next);
    const config = finalize(versioned);

    await behaviorConfigStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.profileId === profileId,
      );
      const items = [...current.items];
      if (index === -1) {
        items.push({ profileId, config });
      } else {
        items[index] = { profileId, config };
      }
      return { next: { items }, result: null };
    });

    return { config, resolution, bumped };
  },

  /** 阶段一与阶段二：纯计算，不改动活动配置（§13.6.5）。 */
  async previewImport(
    profileId: string,
    profileName: string,
    raw: string,
  ): Promise<ImportPreview> {
    const current = await this.get(profileId, profileName);
    return prepareImport(raw, current);
  },

  /**
   * 阶段三：备份 → 原子写入 → 审计。
   *
   * 备份在写入之前，且备份失败即中止——否则一次失败的导入会既没有备份
   * 也可能留下半份配置。
   */
  async commitImport(
    profileId: string,
    profileName: string,
    preview: ImportPreview,
    sourceFileName: string,
  ) {
    const current = await this.get(profileId, profileName);
    const { config, audit } = commitImport(preview, current, sourceFileName);

    // 从未保存过的档案没有可备份的活动配置，跳过备份而不是备份一份默认值。
    const backup = (await this.has(profileId))
      ? await backupActiveConfig(current)
      : null;

    await behaviorConfigStore.update((store) => {
      const index = store.items.findIndex(
        (item) => item.profileId === profileId,
      );
      const items = [...store.items];
      if (index === -1) {
        items.push({ profileId, config });
      } else {
        items[index] = { profileId, config };
      }
      return { next: { items }, result: null };
    });

    return { config, audit, backup };
  },

  async removeForProfile(profileId: string): Promise<void> {
    await behaviorConfigStore.update((current) => ({
      next: {
        items: current.items.filter((item) => item.profileId !== profileId),
      },
      result: null,
    }));
  },
};
