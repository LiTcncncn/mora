import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import {
  accountsFileSchema,
  type AccountUser,
  type AccountsFile,
  type PublicSessionUser,
} from "@/domain/accounts";
import { AppError } from "@/server/api/errors";
import { getDataDir } from "@/server/config/env";

/** 进程内缓存：accounts.json 改完需重启（设计已定）。 */
let cached: AccountsFile | null = null;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureAccountsSeeded(): Promise<string> {
  const dir = getDataDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "accounts.json");
  if (await fileExists(target)) return target;

  const seed = path.join(process.cwd(), "data-seed", "accounts.json");
  if (!(await fileExists(seed))) {
    throw new AppError(
      "DATA_READ_ERROR",
      "缺少 accounts.json，且 data-seed 中没有种子文件",
    );
  }
  await fs.copyFile(seed, target);
  return target;
}

export async function loadAccountsFile(): Promise<AccountsFile> {
  if (cached) return cached;
  const filePath = await ensureAccountsSeeded();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    throw new AppError("DATA_READ_ERROR", "无法读取 accounts.json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("DATA_VALIDATION_ERROR", "accounts.json 不是合法 JSON");
  }
  const result = accountsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError("DATA_VALIDATION_ERROR", "accounts.json 校验失败");
  }
  if (!result.data.users.some((user) => user.role === "admin" && user.enabled)) {
    throw new AppError(
      "DATA_VALIDATION_ERROR",
      "accounts.json 中至少需要一名启用的管理员",
    );
  }
  cached = result.data;
  return cached;
}

export async function findAccountByUsername(
  username: string,
): Promise<AccountUser | null> {
  const file = await loadAccountsFile();
  const normalized = username.trim().toLowerCase();
  return (
    file.users.find(
      (user) => user.username.toLowerCase() === normalized && user.enabled,
    ) ?? null
  );
}

export function toPublicUser(user: AccountUser): PublicSessionUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
  };
}
