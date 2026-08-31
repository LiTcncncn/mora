import { describe, expect, it } from "vitest";
import type { FewShotSample } from "./fewshot";
import { parseFewShotText, serializeFewShotSamples } from "./fewshot-text";

function makeSample(overrides: Partial<FewShotSample> = {}): FewShotSample {
  return {
    id: "fs-1",
    profileId: "profile-default",
    scene: "疲惫不想动",
    energy: "E1",
    worldview: "L2",
    keywords: ["累", "躺"],
    user: "好累，什么都不想干。",
    reply: "躺着就躺着吧。",
    note: "不追问原因。",
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("few-shot 文本格式", () => {
  it("序列化后再解析，内容不变", () => {
    const samples = [
      makeSample(),
      makeSample({
        id: "fs-2",
        scene: "深夜",
        energy: "any",
        worldview: "none",
        enabled: false,
        keywords: [],
        note: "",
      }),
    ];
    const { records, issues } = parseFewShotText(
      serializeFewShotSamples(samples),
    );
    expect(issues).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: "fs-1",
      scene: "疲惫不想动",
      energy: "E1",
      worldview: "L2",
      enabled: true,
      keywords: ["累", "躺"],
      user: "好累，什么都不想干。",
      reply: "躺着就躺着吧。",
      note: "不追问原因。",
    });
    expect(records[1]).toMatchObject({
      id: "fs-2",
      energy: "any",
      worldview: "none",
      enabled: false,
      keywords: [],
      note: "",
    });
  });

  it("没有 id 的记录当作新建", () => {
    const { records, issues } = parseFewShotText(
      ["场景: 新场景", "用户: 在吗", "回复: 在的"].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(records[0]!.id).toBeNull();
    // 未填的字段用默认值，不报错。
    expect(records[0]).toMatchObject({
      energy: "any",
      worldview: "none",
      enabled: true,
      keywords: [],
      note: "",
    });
  });

  it("[新建] 等同于不写 id", () => {
    const { records } = parseFewShotText(
      ["[新建]", "场景: 新场景", "用户: 在吗", "回复: 在的"].join("\n"),
    );
    expect(records[0]!.id).toBeNull();
  });

  it("字段值可以换行续写", () => {
    const { records, issues } = parseFewShotText(
      [
        "场景: 多行",
        "用户: 第一行",
        "第二行",
        "回复: 回复第一行",
        "回复第二行",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(records[0]!.user).toBe("第一行\n第二行");
    expect(records[0]!.reply).toBe("回复第一行\n回复第二行");
  });

  it("缺必填字段时跳过该条并报出行号", () => {
    const { records, issues } = parseFewShotText(
      [
        "场景: 完整的",
        "用户: 在吗",
        "回复: 在的",
        "---",
        "场景: 缺回复",
        "用户: 在吗",
      ].join("\n"),
    );
    expect(records).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("回复");
    expect(issues[0]!.line).toBe(5);
  });

  it("档位和世界观填错时报错而不是静默改值", () => {
    const { records, issues } = parseFewShotText(
      ["场景: 错档位", "档位: E9", "用户: 在吗", "回复: 在的"].join("\n"),
    );
    expect(records).toHaveLength(0);
    expect(issues[0]!.message).toContain("档位");
    expect(issues[0]!.line).toBe(2);
  });

  it("id 重复时报错", () => {
    const { records, issues } = parseFewShotText(
      [
        "[fs-1]",
        "场景: 一",
        "用户: 在吗",
        "回复: 在的",
        "---",
        "[fs-1]",
        "场景: 二",
        "用户: 在吗",
        "回复: 在的",
      ].join("\n"),
    );
    expect(records).toHaveLength(1);
    expect(issues[0]!.message).toContain("重复");
  });

  it("能量档位和启用接受中文写法", () => {
    const { records, issues } = parseFewShotText(
      [
        "场景: 中文写法",
        "档位: 通用",
        "世界观: 无",
        "启用: 否",
        "用户: 在吗",
        "回复: 在的",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(records[0]).toMatchObject({
      energy: "any",
      worldview: "none",
      enabled: false,
    });
  });

  it("接受界面上那种带说明的档位写法", () => {
    const { records } = parseFewShotText(
      [
        "场景: 带说明",
        "档位: E1 低电量",
        "世界观: L2 雨林联想",
        "用户: 在吗",
        "回复: 在的",
      ].join("\n"),
    );
    expect(records[0]).toMatchObject({ energy: "E1", worldview: "L2" });
  });

  it("空文本解析出零条记录且不报错", () => {
    expect(parseFewShotText("   \n\n  ")).toEqual({ records: [], issues: [] });
  });
});
