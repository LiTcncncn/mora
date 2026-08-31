import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";
import { CURRENT_SCHEMA_VERSION, storeEnvelopeSchema } from "@/domain/store";
import { AppError } from "../api/errors";
import { getDataDir } from "../config/env";
import { enqueueWrite } from "./write-queue";

export type StoreFileName =
  | "profiles"
  | "settings"
  | "personas"
  | "memories"
  | "conversations"
  | "prompt-presets"
  | "fewshot"
  | "runs"
  | "evals"
  | "behavior-config";

/** 路径只能由固定文件名构造，绝不接受来自 API 的任意路径。 */
function resolveStorePath(name: StoreFileName): string {
  return path.join(getDataDir(), `${name}.json`);
}

function resolveSeedPath(name: StoreFileName): string {
  return path.join(process.cwd(), "data-seed", `${name}.json`);
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 首次启动时从 data-seed 复制。 */
async function ensureSeeded(name: StoreFileName): Promise<void> {
  await ensureDataDir();
  const target = resolveStorePath(name);
  if (await fileExists(target)) return;

  const seed = resolveSeedPath(name);
  if (!(await fileExists(seed))) {
    throw new AppError(
      "DATA_READ_ERROR",
      `缺少初始数据文件 ${name}.json，且 data-seed 中没有对应种子`,
    );
  }
  await fs.copyFile(seed, target);
}

export class JsonStore<T> {
  constructor(
    private readonly name: StoreFileName,
    private readonly dataSchema: ZodType<T>,
  ) {}

  private get envelopeSchema() {
    return storeEnvelopeSchema(this.dataSchema);
  }

  async read(): Promise<T> {
    await ensureSeeded(this.name);
    const filePath = resolveStorePath(this.name);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      throw new AppError("DATA_READ_ERROR", `无法读取本地数据文件 ${this.name}.json`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError(
        "DATA_VALIDATION_ERROR",
        `本地数据文件 ${this.name}.json 不是合法 JSON。已停止写入，请检查该文件与同目录的 ${this.name}.json.bak`,
      );
    }

    const result = this.envelopeSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(
        "DATA_VALIDATION_ERROR",
        `本地数据文件 ${this.name}.json 校验失败。已停止写入，请检查该文件与同目录的 ${this.name}.json.bak`,
      );
    }

    if (result.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new AppError(
        "DATA_VALIDATION_ERROR",
        `本地数据文件 ${this.name}.json 的 schemaVersion 高于当前程序支持的版本，已停止写入以避免覆盖`,
      );
    }

    return result.data.data as T;
  }

  /**
   * 读取 → 生成 → 校验 → 临时文件 → .bak → 原子 rename。
   * 任何失败都保留原文件。
   */
  async update<R>(mutator: (current: T) => { next: T; result: R }): Promise<R> {
    return enqueueWrite(this.name, async () => {
      const current = await this.read();
      const { next, result } = mutator(current);

      const validation = this.dataSchema.safeParse(next);
      if (!validation.success) {
        throw new AppError(
          "DATA_VALIDATION_ERROR",
          `写入 ${this.name}.json 前的数据校验失败，已保留原文件`,
        );
      }

      const filePath = resolveStorePath(this.name);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      const backupPath = `${filePath}.bak`;

      const envelope = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        data: validation.data,
      };

      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(tempPath, "w");
        await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        await handle.sync();
      } catch {
        await fs.rm(tempPath, { force: true });
        throw new AppError("DATA_WRITE_ERROR", `写入临时文件失败：${this.name}.json`);
      } finally {
        await handle?.close();
      }

      try {
        await fs.copyFile(filePath, backupPath);
        await fs.rename(tempPath, filePath);
      } catch {
        await fs.rm(tempPath, { force: true });
        throw new AppError("DATA_WRITE_ERROR", `替换数据文件失败：${this.name}.json`);
      }

      return result;
    });
  }

  async write(next: T): Promise<T> {
    return this.update(() => ({ next, result: next }));
  }
}
