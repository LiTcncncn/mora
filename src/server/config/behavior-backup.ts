import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import { AppError } from "../api/errors";
import { getDataDir } from "./env";
import { buildConfigExport, serializeExport } from "./behavior-transfer";

/**
 * §13.6.9：备份策略。
 *
 * 格式与正常导出完全一致，便于直接重新导入。恢复走与导入完全相同的
 * 三阶段流程，不走捷径——捷径会绕过校验，而备份文件同样可能被手工编辑过。
 */

/** 保留最近 20 份。按份数而不是按时间：导入是低频操作，按时间滚动可能一份不剩。 */
export const MAX_BACKUPS = 20;

const BACKUP_DIR_NAME = "config-backups";
/** `<ISO 时间戳>-<旧 configHash 前 8 位>.json`，时间戳里的冒号不能进文件名。 */
const BACKUP_FILE_PATTERN = /^[\dT-]+Z-[\da-f]{8}\.json$/;

export function getBackupDir(): string {
  return path.join(getDataDir(), BACKUP_DIR_NAME);
}

function backupFileName(config: BehaviorConfigV2, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${config.configHash.slice(0, 8)}.json`;
}

export interface BackupEntry {
  fileName: string;
  configHash: string;
  createdAt: string;
  sizeBytes: number;
}

/**
 * 备份当前活动配置。
 *
 * 触发时机（§13.6.9）：每次导入前、每次 v1→v2 迁移前、每次批量单库导入前。
 * 单条编辑不触发——有 `version` 与审计可追。
 */
export async function backupActiveConfig(
  config: BehaviorConfigV2,
  now: Date = new Date(),
): Promise<BackupEntry> {
  const dir = getBackupDir();
  await fs.mkdir(dir, { recursive: true });

  const fileName = backupFileName(config, now);
  const filePath = path.join(dir, fileName);
  const contents = serializeExport(
    buildConfigExport(config, now.toISOString()),
  );

  // 与 JsonStore 同样的原子写入：临时文件加 rename，失败不留半份文件。
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);
  } catch {
    await fs.rm(tempPath, { force: true });
    throw new AppError("DATA_WRITE_ERROR", "写入配置备份失败，已中止导入");
  }

  await pruneBackups();

  return {
    fileName,
    configHash: config.configHash,
    createdAt: now.toISOString(),
    sizeBytes: Buffer.byteLength(contents, "utf8"),
  };
}

/** 按文件名倒序即时间倒序：ISO 时间戳的字典序与时间序一致。 */
export async function listBackups(): Promise<BackupEntry[]> {
  const dir = getBackupDir();

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const entries: BackupEntry[] = [];
  for (const name of names.filter((item) => BACKUP_FILE_PATTERN.test(item))) {
    const stat = await fs.stat(path.join(dir, name));
    entries.push({
      fileName: name,
      configHash: name.slice(-13, -5),
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }

  return entries.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/**
 * 读取一份备份的原文，交给导入流程处理。
 *
 * 返回原文而不是解析后的对象：恢复必须走与导入完全相同的三阶段流程
 * （§13.6.9），而那个流程的入口是文件原文。
 */
export async function readBackup(fileName: string): Promise<string> {
  // 文件名来自 API，必须先按固定格式校验，绝不拼接任意路径。
  if (!BACKUP_FILE_PATTERN.test(fileName)) {
    throw new AppError("VALIDATION_ERROR", "备份文件名格式不合法");
  }

  try {
    return await fs.readFile(path.join(getBackupDir(), fileName), "utf8");
  } catch {
    throw new AppError("NOT_FOUND", "找不到该备份文件");
  }
}

async function pruneBackups(): Promise<void> {
  const entries = await listBackups();
  for (const entry of entries.slice(MAX_BACKUPS)) {
    await fs.rm(path.join(getBackupDir(), entry.fileName), { force: true });
  }
}
