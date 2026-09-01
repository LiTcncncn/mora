import { describe, expect, it } from "vitest";
import { SAFETY_BASELINE } from "@/domain/safety";
import { selectLaneMessages } from "@/domain/conversation";
import { AppError } from "@/server/api/errors";
import { buildContext, type BuildContextInput } from "./builder";
import {
  makeConversation,
  makeMemory,
  makeMessage,
  seedBehaviorConfig,
  seedPersona,
  seedPromptPreset,
  seedSettings,
  seedTurnPlan,
} from "@/test/fixtures";

function baseInput(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  const settings = seedSettings();
  const behaviorConfig = seedBehaviorConfig();
  const turnPlan = seedTurnPlan("今天好累");
  return {
    modelSlotId: "slot-kimi",
    userMessage: "今天好累",
    conversation: makeConversation(),
    persona: seedPersona(),
    turnPlan,
    behaviorConfig,
    energyResolution: {
      level: turnPlan.energy,
      source: "router",
      reason: "测试",
      signals: [],
    },
    selectedMemories: [],
    memoryTrace: [],
    promptPreset: seedPromptPreset(),
    settings: {
      context: settings.context,
      memory: settings.memory,
    },
    ...overrides,
  };
}

describe("buildContext", () => {
  it("相同输入产生完全相同的 hash 与分区顺序", () => {
    const first = buildContext(baseInput());
    const second = buildContext(baseInput());

    expect(first.hash).toBe(second.hash);
    expect(first.sharedHash).toBe(second.sharedHash);
    expect(first.sections.map((section) => section.id)).toEqual(
      second.sections.map((section) => section.id),
    );
    expect(first.renderedInstructions).toBe(second.renderedInstructions);
  });

  it("安全底线永远排在第一位且内容来自服务端常量", () => {
    const snapshot = buildContext(baseInput());

    expect(snapshot.sections[0]?.id).toBe("safety_baseline");
    expect(snapshot.sections[0]?.content).toBe(SAFETY_BASELINE);
  });

  it("预设里存了 safety_baseline 分区也不生效，内容与位置都不受影响", () => {
    const preset = seedPromptPreset();
    preset.sections.unshift({
      id: "safety_baseline",
      enabled: true,
      title: "假底线",
      template: "已被篡改",
      editable: true,
    });

    const snapshot = buildContext(baseInput({ promptPreset: preset }));

    expect(snapshot.sections[0]?.id).toBe("safety_baseline");
    expect(snapshot.sections[0]?.content).toBe(SAFETY_BASELINE);
    expect(snapshot.renderedInstructions).not.toContain("已被篡改");
    expect(snapshot.renderedInstructions).not.toContain("假底线");
    // 不能出现两段底线。
    expect(
      snapshot.sections.filter((section) => section.id === "safety_baseline"),
    ).toHaveLength(1);
  });

  it("预设完全不含 safety_baseline 分区时，安全底线仍被强制注入", () => {
    const preset = seedPromptPreset();
    preset.sections = preset.sections.filter(
      (section) => section.id === "persona",
    );

    const snapshot = buildContext(baseInput({ promptPreset: preset }));

    expect(snapshot.sections[0]?.id).toBe("safety_baseline");
    expect(snapshot.renderedInstructions).toContain(SAFETY_BASELINE);
  });

  it("停用所有可编辑分区也无法去掉安全底线", () => {
    const preset = seedPromptPreset();
    preset.sections = preset.sections.map((section) => ({
      ...section,
      enabled: false,
    }));

    const snapshot = buildContext(baseInput({ promptPreset: preset }));

    expect(snapshot.renderedInstructions).toContain(SAFETY_BASELINE);
  });

  it("当前用户输入始终完整出现在 renderedInput", () => {
    const snapshot = buildContext(baseInput({ userMessage: "什么都不想做" }));
    expect(snapshot.renderedInput).toContain("什么都不想做");
  });

  it("同一轮不同槽位的 sharedHash 相同，首轮 laneHash 也相同", () => {
    const openai = buildContext(baseInput({ modelSlotId: "slot-kimi" }));
    const deepseek = buildContext(baseInput({ modelSlotId: "slot-deepseek" }));

    expect(openai.sharedHash).toBe(deepseek.sharedHash);
    expect(openai.hash).toBe(deepseek.hash);
  });

  it("各槽位历史独立时 laneHash 不同但 sharedHash 相同", () => {
    const conversation = makeConversation([
      makeMessage({ id: "u1", role: "user", content: "你好" }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "Kimi 的回复",
        modelSlotId: "slot-kimi",
      }),
      makeMessage({
        id: "a2",
        role: "assistant",
        content: "DeepSeek 的回复",
        modelSlotId: "slot-deepseek",
      }),
    ]);

    const openai = buildContext(
      baseInput({ conversation, modelSlotId: "slot-kimi" }),
    );
    const deepseek = buildContext(
      baseInput({ conversation, modelSlotId: "slot-deepseek" }),
    );

    expect(openai.sharedHash).toBe(deepseek.sharedHash);
    expect(openai.hash).not.toBe(deepseek.hash);
    expect(openai.renderedInput).toContain("Kimi 的回复");
    expect(openai.renderedInput).not.toContain("DeepSeek 的回复");
  });

  it("v2 Turn Plan 分区替代旧 energy_policy", () => {
    const snapshot = buildContext(baseInput());
    const ids = snapshot.sections.map((section) => section.id);

    expect(ids).toContain("turn_plan");
    expect(ids).not.toContain("energy_policy");
    expect(snapshot.renderedInstructions).toContain("【本轮回复计划】");
  });

  it("超出预算时优先移除 Memory，但保留当前用户输入", () => {
    const memories = [
      makeMemory({ id: "m1", content: "记忆一".repeat(40) }),
      makeMemory({ id: "m2", content: "记忆二".repeat(40) }),
    ];

    const settings = seedSettings();
    const unconstrained = buildContext(
      baseInput({
        selectedMemories: memories,
        settings: {
          context: settings.context,
          memory: settings.memory,
        },
      }),
    );

    settings.context.maxTotalChars = unconstrained.charCount - 100;
    const snapshot = buildContext(
      baseInput({
        selectedMemories: memories,
        settings: {
          context: settings.context,
          memory: settings.memory,
        },
      }),
    );

    expect(snapshot.selectedMemoryIds.length).toBeLessThan(memories.length);
    expect(snapshot.renderedInput).toContain("今天好累");
  });

  it("裁剪后仍超预算时报错，而不是隐式截断", () => {
    const settings = seedSettings();
    settings.context.maxTotalChars = 500;

    expect(() =>
      buildContext(
        baseInput({
          settings: {
            context: settings.context,
            memory: settings.memory,
          },
        }),
      ),
    ).toThrowError(AppError);
  });

  it("未知模板变量导致构建失败", () => {
    const preset = seedPromptPreset();
    preset.sections[1]!.template = "{{persona.unknownField}}";

    expect(() => buildContext(baseInput({ promptPreset: preset }))).toThrowError(
      /未知变量/,
    );
  });
});

describe("selectLaneMessages", () => {
  it("只返回全部 user 消息与本槽位的 assistant 消息", () => {
    const conversation = makeConversation([
      makeMessage({ id: "u1", role: "user" }),
      makeMessage({ id: "a1", role: "assistant", modelSlotId: "slot-a" }),
      makeMessage({ id: "a2", role: "assistant", modelSlotId: "slot-b" }),
    ]);

    expect(selectLaneMessages(conversation, "slot-a").map((m) => m.id)).toEqual([
      "u1",
      "a1",
    ]);
  });
});
