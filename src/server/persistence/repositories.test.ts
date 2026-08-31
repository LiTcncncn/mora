import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../api/errors";
import { getDataDir } from "../config/env";
import { ensureBootstrapped } from "./bootstrap";
import {
  conversationRepository,
  memoryRepository,
  profileRepository,
  runRepository,
  settingsRepository,
} from "./repositories";
import { makeMemory, makeRunRecord } from "@/test/fixtures";

const DEFAULT_PROFILE = "profile-default";

beforeEach(async () => {
  await fs.rm(getDataDir(), { recursive: true, force: true });
  await fs.mkdir(getDataDir(), { recursive: true });
  await ensureBootstrapped().catch(() => undefined);
});

describe("档案隔离", () => {
  it("新建档案会得到独立的设置、Persona 与 Preset", async () => {
    const created = await profileRepository.create("上班族 A");
    const defaultSettings = await settingsRepository.get(DEFAULT_PROFILE);
    const newSettings = await settingsRepository.get(created.id);

    expect(newSettings.activePersonaId).not.toBe(defaultSettings.activePersonaId);
    expect(newSettings.activePromptPresetId).not.toBe(
      defaultSettings.activePromptPresetId,
    );
  });

  it("跨档案访问实体返回 NOT_FOUND", async () => {
    const other = await profileRepository.create("学生 B");
    const memory = await memoryRepository.create(
      makeMemory({ id: "mem-iso", profileId: DEFAULT_PROFILE }),
    );

    await expect(
      memoryRepository.get(other.id, memory.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Memory 列表只返回本档案条目", async () => {
    const other = await profileRepository.create("学生 B");
    await memoryRepository.create(makeMemory({ id: "a", profileId: DEFAULT_PROFILE }));
    await memoryRepository.create(makeMemory({ id: "b", profileId: other.id }));

    expect((await memoryRepository.list(DEFAULT_PROFILE)).map((m) => m.id)).toEqual([
      "a",
    ]);
    expect((await memoryRepository.list(other.id)).map((m) => m.id)).toEqual(["b"]);
  });

  it("删除档案会级联删除其数据，且不影响其他档案", async () => {
    const other = await profileRepository.create("待删除");
    await memoryRepository.create(makeMemory({ id: "keep", profileId: DEFAULT_PROFILE }));
    await memoryRepository.create(makeMemory({ id: "drop", profileId: other.id }));

    await profileRepository.remove(other.id);

    expect((await memoryRepository.list(DEFAULT_PROFILE)).map((m) => m.id)).toEqual([
      "keep",
    ]);
    await expect(settingsRepository.get(other.id)).rejects.toBeInstanceOf(AppError);
  });

  it("不允许删除最后一个档案", async () => {
    await expect(
      profileRepository.remove(DEFAULT_PROFILE),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("原子写入", () => {
  it("写入后生成 .bak 且主文件保持合法 JSON", async () => {
    await conversationRepository.create(DEFAULT_PROFILE, "第一个对话");
    await conversationRepository.create(DEFAULT_PROFILE, "第二个对话");

    const filePath = path.join(getDataDir(), "conversations.json");
    const raw = await fs.readFile(filePath, "utf8");

    expect(() => JSON.parse(raw)).not.toThrow();
    await expect(fs.access(`${filePath}.bak`)).resolves.toBeUndefined();
  });

  it("并发写入串行执行，不丢数据", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        conversationRepository.create(DEFAULT_PROFILE, `并发 ${index}`),
      ),
    );

    expect(await conversationRepository.list(DEFAULT_PROFILE)).toHaveLength(8);
  });

  it("损坏的数据文件会阻止写入并返回明确错误", async () => {
    const filePath = path.join(getDataDir(), "conversations.json");
    await conversationRepository.create(DEFAULT_PROFILE, "初始");
    await fs.writeFile(filePath, "{ 不是 JSON", "utf8");

    await expect(
      conversationRepository.create(DEFAULT_PROFILE, "再来一个"),
    ).rejects.toMatchObject({ code: "DATA_VALIDATION_ERROR" });
  });
});

describe("runs 容量控制", () => {
  it("超过上限时只删除本档案最旧记录", async () => {
    const other = await profileRepository.create("其他档案");
    await runRepository.appendMany(
      [makeRunRecord({ id: "other-run", profileId: other.id })],
      100,
    );

    await runRepository.appendMany(
      [
        makeRunRecord({ id: "old", startedAt: "2026-01-01T00:00:00.000Z" }),
        makeRunRecord({ id: "mid", startedAt: "2026-02-01T00:00:00.000Z" }),
        makeRunRecord({ id: "new", startedAt: "2026-03-01T00:00:00.000Z" }),
      ],
      2,
    );

    const kept = (await runRepository.list(DEFAULT_PROFILE)).map((run) => run.id);
    expect(kept).toEqual(["mid", "new"]);
    expect(await runRepository.list(other.id)).toHaveLength(1);
  });
});

describe("Memory 使用统计", () => {
  it("markUsed 只更新指定档案的条目", async () => {
    await memoryRepository.create(makeMemory({ id: "used" }));
    await memoryRepository.markUsed(DEFAULT_PROFILE, ["used"]);

    const memory = await memoryRepository.get(DEFAULT_PROFILE, "used");
    expect(memory.useCount).toBe(1);
    expect(memory.lastUsedAt).not.toBeNull();
  });
});
