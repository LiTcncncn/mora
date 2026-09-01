import { describe, expect, it, vi } from "vitest";
import { measurePolicyDeviation, renderEnergyPolicy, resolveEnergy } from "./resolver";
import * as classifier from "./llm-classifier";
import { seedSettings } from "@/test/fixtures";

describe("resolveEnergy", () => {
  it("manual 模式始终返回设置中的固定档位", async () => {
    const settings = seedSettings().energy;
    settings.mode = "manual";
    settings.manualLevel = "E2";

    const result = await resolveEnergy({ userMessage: "累死了", settings });

    expect(result.level).toBe("E2");
    expect(result.source).toBe("manual");
  });

  it("本轮 override 优先于规则判定", async () => {
    const settings = seedSettings().energy;
    const result = await resolveEnergy({
      userMessage: "想聊聊我的计划",
      settings,
      override: "E0",
    });

    expect(result.level).toBe("E0");
    expect(result.source).toBe("override");
  });

  it("低能量关键词把档位向低推，并给出可解释的 signals", async () => {
    const settings = seedSettings().energy;
    settings.mode = "rule_based";
    settings.manualLevel = "E2";

    const result = await resolveEnergy({ userMessage: "好累，什么都不想做", settings });

    expect(result.source).toBe("rule_based");
    expect(result.level).toBe("E0");
    expect(result.signals.some((signal) => signal.matched)).toBe(true);
    expect(result.reason).toContain("E2");
  });

  it("同样输入总是得到同样结果", async () => {
    const settings = seedSettings().energy;
    settings.mode = "rule_based";
    const first = await resolveEnergy({ userMessage: "有点烦", settings });
    const second = await resolveEnergy({ userMessage: "有点烦", settings });
    expect(first).toEqual(second);
  });

  it("llm 模式采用模型档位，并保留规则草稿信号", async () => {
    const settings = seedSettings().energy;
    settings.mode = "llm";
    const spy = vi
      .spyOn(classifier, "classifyEnergyWithLlm")
      .mockResolvedValue({ level: "E0", reason: "整句语义是撑不住" });

    const result = await resolveEnergy({
      userMessage: "我笑着说我很好，其实已经撑不住了",
      settings,
    });

    expect(result.source).toBe("llm");
    expect(result.level).toBe("E0");
    expect(result.reason).toContain("撑不住");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("renderEnergyPolicy", () => {
  it("E0 默认不建议，允许一个非强制的轻问", () => {
    const settings = seedSettings().energy;
    const text = renderEnergyPolicy("E0", settings, {
      includeReason: false,
      reason: "",
    });

    expect(text).toContain("不要提出任何行动建议");
    expect(text).not.toContain("最多提问");
    expect(text).toContain("不要再追");
  });

  it("includeReason 关闭时不泄露判定依据", () => {
    const settings = seedSettings().energy;
    const text = renderEnergyPolicy("E1", settings, {
      includeReason: false,
      reason: "内部判定说明",
    });
    expect(text).not.toContain("内部判定说明");
  });
});

describe("measurePolicyDeviation", () => {
  it("只记录偏差，不改动文本", () => {
    const settings = seedSettings().energy;
    const long = "这是一句很长的话。".repeat(20);
    const deviation = measurePolicyDeviation(long, "E0", settings);

    expect(deviation?.withinTarget).toBe(false);
    expect(deviation?.actualChars).toBe([...long].length);
  });
});
