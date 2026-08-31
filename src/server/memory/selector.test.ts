import { describe, expect, it } from "vitest";
import { selectMemories, tokenize } from "./selector";
import { makeMemory, seedSettings } from "@/test/fixtures";

describe("tokenize", () => {
  it("对中文生成字符与 bigram，对英文生成小写单词", () => {
    const tokens = tokenize("项目 Deadline");
    expect(tokens.has("项目")).toBe(true);
    expect(tokens.has("deadline")).toBe(true);
  });
});

describe("selectMemories", () => {
  const settings = seedSettings().memory;

  it("停用、非 active、过期与低重要度条目不会入选", () => {
    const memories = [
      makeMemory({ id: "disabled", enabled: false }),
      makeMemory({ id: "candidate", status: "candidate" }),
      makeMemory({ id: "expired", expiresAt: "2020-01-01T00:00:00.000Z" }),
      makeMemory({ id: "low", importance: 0.1 }),
    ];

    const result = selectMemories({ memories, userMessage: "项目", settings });

    expect(result.selected).toHaveLength(0);
    expect(result.trace.every((entry) => !entry.selected)).toBe(true);
    expect(
      result.trace.find((entry) => entry.memoryId === "candidate")?.reason,
    ).toContain("candidate");
  });

  it("pinned 条目可以绕过重要度阈值", () => {
    const memories = [makeMemory({ id: "pinned", importance: 0.05, pinned: true })];
    const result = selectMemories({ memories, userMessage: "项目", settings });
    expect(result.selected.map((memory) => memory.id)).toEqual(["pinned"]);
  });

  it("遵守 topK 与字符预算", () => {
    const constrained = { ...settings, topK: 1 };
    const memories = [
      makeMemory({ id: "a", importance: 0.9 }),
      makeMemory({ id: "b", importance: 0.8 }),
    ];

    const result = selectMemories({
      memories,
      userMessage: "项目交接",
      settings: constrained,
    });

    expect(result.selected).toHaveLength(1);
    expect(
      result.trace.find((entry) => entry.memoryId === "b")?.reason,
    ).toContain("topK");
  });

  it("排序稳定，重复调用结果一致", () => {
    const memories = [
      makeMemory({ id: "a", importance: 0.5 }),
      makeMemory({ id: "b", importance: 0.5 }),
      makeMemory({ id: "c", importance: 0.5 }),
    ];
    const now = new Date("2026-08-21T00:00:00.000Z");

    const first = selectMemories({ memories, userMessage: "项目", settings, now });
    const second = selectMemories({ memories, userMessage: "项目", settings, now });

    expect(first.selected.map((m) => m.id)).toEqual(
      second.selected.map((m) => m.id),
    );
  });

  it("关闭 Memory 注入时不选择任何条目", () => {
    const disabled = { ...settings, enabled: false };
    const result = selectMemories({
      memories: [makeMemory()],
      userMessage: "项目",
      settings: disabled,
    });
    expect(result.selected).toHaveLength(0);
  });
});
