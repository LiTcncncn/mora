import { describe, expect, it } from "vitest";
import type { FewShotSample } from "@/domain/fewshot";
import type { FewShotSettings } from "@/domain/settings";
import { selectFewShotSamples } from "./selector";

function makeSample(overrides: Partial<FewShotSample> = {}): FewShotSample {
  return {
    id: "fs-1",
    profileId: "profile-default",
    scene: "疲惫不想动",
    energy: "any",
    worldview: "none",
    keywords: ["累", "躺"],
    user: "好累，什么都不想干。",
    reply: "躺着就躺着吧。",
    note: "",
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const settings: FewShotSettings = {
  enabled: true,
  maxPerLevel: { E0: 1, E1: 2, E2: 2, E3: 3 },
  maxWorldviewPerTurn: 1,
  maxChars: 1500,
  minScore: 0,
};

describe("selectFewShotSamples", () => {
  it("关闭时不注入任何样本", () => {
    const result = selectFewShotSamples({
      samples: [makeSample()],
      userMessage: "好累",
      energyLevel: "E1",
      settings: { ...settings, enabled: false },
    });
    expect(result.selected).toHaveLength(0);
    expect(result.trace[0]!.reason).toContain("已在设置中关闭");
  });

  it("按能量档位限制注入条数", () => {
    const samples = [
      makeSample({ id: "fs-1" }),
      makeSample({ id: "fs-2" }),
      makeSample({ id: "fs-3" }),
    ];
    const e0 = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E0",
      settings,
    });
    const e3 = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E3",
      settings,
    });
    expect(e0.selected).toHaveLength(1);
    expect(e3.selected).toHaveLength(3);
  });

  it("排除停用的样本", () => {
    const result = selectFewShotSamples({
      samples: [makeSample({ id: "fs-off", enabled: false })],
      userMessage: "好累",
      energyLevel: "E1",
      settings,
    });
    expect(result.selected).toHaveLength(0);
    expect(result.trace[0]!.reason).toContain("已停用");
  });

  it("低档样本不进高档轮次：示例太短会和「通常三到五句」打架", () => {
    const samples = [makeSample({ id: "fs-e0", energy: "E0" })];
    for (const level of ["E1", "E2", "E3"] as const) {
      const result = selectFewShotSamples({
        samples,
        userMessage: "好累",
        energyLevel: level,
        settings,
      });
      expect(result.selected).toHaveLength(0);
      expect(result.trace[0]!.reason).toContain("回复长度不适合");
    }
  });

  it("高档样本可以向下用一档，跨两档则排除", () => {
    const samples = [makeSample({ id: "fs-e2", energy: "E2" })];
    const atE1 = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E1",
      settings,
    });
    const atE0 = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E0",
      settings,
    });
    expect(atE1.selected).toHaveLength(1);
    expect(atE0.selected).toHaveLength(0);
  });

  it("标注 any 的样本在任何档位都可用", () => {
    const samples = [makeSample({ id: "fs-any", energy: "any" })];
    for (const level of ["E0", "E1", "E2", "E3"] as const) {
      const result = selectFewShotSamples({
        samples,
        userMessage: "好累",
        energyLevel: level,
        settings,
      });
      expect(result.selected).toHaveLength(1);
    }
  });

  it("同一轮最多注入一条带世界观的样本", () => {
    const result = selectFewShotSamples({
      samples: [
        makeSample({ id: "fs-w1", worldview: "L2" }),
        makeSample({ id: "fs-w2", worldview: "L1" }),
        makeSample({ id: "fs-plain" }),
      ],
      userMessage: "好累，什么都不想干",
      energyLevel: "E3",
      settings,
    });
    const worldviewCount = result.selected.filter(
      (sample) => sample.worldview !== "none",
    ).length;
    expect(worldviewCount).toBe(1);
    expect(result.selected).toHaveLength(2);
  });

  it("相关度更高的样本排在前面", () => {
    const result = selectFewShotSamples({
      samples: [
        makeSample({
          id: "fs-sleep",
          scene: "深夜想下结论",
          keywords: ["深夜", "睡不着"],
          user: "凌晨两点还醒着。",
        }),
        makeSample({ id: "fs-tired", scene: "疲惫不想动" }),
      ],
      userMessage: "好累，只想躺着",
      energyLevel: "E1",
      settings,
    });
    expect(result.selected[0]!.id).toBe("fs-tired");
  });

  it("字符预算不足时停止注入", () => {
    const result = selectFewShotSamples({
      samples: [makeSample({ id: "fs-1" }), makeSample({ id: "fs-2" })],
      userMessage: "好累",
      energyLevel: "E3",
      settings: { ...settings, maxChars: 20 },
    });
    expect(result.selected).toHaveLength(1);
    expect(
      result.trace.some((entry) => entry.reason.includes("字符预算")),
    ).toBe(true);
  });

  it("相关度低于阈值时宁可不给示例", () => {
    const result = selectFewShotSamples({
      samples: [makeSample({ id: "fs-1" })],
      userMessage: "帮我把这段英文翻译一下",
      energyLevel: "E1",
      settings: { ...settings, minScore: 0.35 },
    });
    expect(result.selected).toHaveLength(0);
    expect(result.trace[0]!.reason).toContain("低于阈值");
  });

  it("不因单个汉字重合而误配：难过不应命中报喜样本", () => {
    const celebrate = makeSample({
      id: "fs-celebrate",
      scene: "分享好消息",
      keywords: ["面试过了", "考过了"],
      user: "我那个面试过了！",
    });
    const result = selectFewShotSamples({
      samples: [celebrate],
      userMessage: "我很难过",
      energyLevel: "E1",
      settings: { ...settings, minScore: 0.35 },
    });
    expect(result.selected).toHaveLength(0);
  });

  it("关键词整条出现在输入里时加分，不被长输入稀释", () => {
    const sample = makeSample({
      id: "fs-grief",
      scene: "事情太重说不出话",
      keywords: ["走了", "确诊"],
      user: "我妈上周走了。",
    });
    const long = "我爸上个月走了，我到现在都还缓不过来，每天都在想这件事";
    const withPhrase = selectFewShotSamples({
      samples: [sample],
      userMessage: long,
      energyLevel: "E1",
      settings: { ...settings, minScore: 0.35 },
    });
    expect(withPhrase.selected.map((item) => item.id)).toEqual(["fs-grief"]);

    // 同样长度、同样话题但没有整条关键词出现时，不应被选中。
    const withoutPhrase = selectFewShotSamples({
      samples: [sample],
      userMessage: "我爸上个月过身了，我到现在都还缓不过来，每天都在想这件事",
      energyLevel: "E1",
      settings: { ...settings, minScore: 0.35 },
    });
    expect(withoutPhrase.selected).toHaveLength(0);
  });

  it("短语加分封顶，堆关键词不能压过场景匹配", () => {
    const stuffed = makeSample({
      id: "fs-stuffed",
      scene: "无关场景",
      keywords: ["累了", "好累", "很累", "疲惫", "没劲"],
      user: "无关内容。",
    });
    const result = selectFewShotSamples({
      samples: [stuffed],
      userMessage: "累了 好累 很累 疲惫 没劲",
      energyLevel: "E1",
      settings,
    });
    expect(result.trace[0]!.score).toBeLessThanOrEqual(1.2 + 1.5);
  });

  it("结果稳定：同样输入两次选出同一批样本", () => {
    const samples = [
      makeSample({ id: "fs-b" }),
      makeSample({ id: "fs-a" }),
      makeSample({ id: "fs-c" }),
    ];
    const first = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E1",
      settings,
    });
    const second = selectFewShotSamples({
      samples,
      userMessage: "好累",
      energyLevel: "E1",
      settings,
    });
    expect(first.selected.map((sample) => sample.id)).toEqual(
      second.selected.map((sample) => sample.id),
    );
  });
});
