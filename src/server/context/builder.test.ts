import { describe, expect, it } from "vitest";
import { SAFETY_BASELINE } from "@/domain/safety";
import { selectLaneMessages } from "@/domain/conversation";
import { AppError } from "@/server/api/errors";
import { buildContext, type BuildContextInput } from "./builder";
import {
  makeConversation,
  makeFewShotSample,
  makeMemory,
  makeMessage,
  seedPersona,
  seedPromptPreset,
  seedSettings,
} from "@/test/fixtures";

function baseInput(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  const settings = seedSettings();
  return {
    modelSlotId: "slot-kimi",
    userMessage: "今天好累",
    conversation: makeConversation(),
    persona: seedPersona(),
    energyResolution: {
      level: "E1",
      source: "rule_based",
      reason: "测试",
      signals: [],
    },
    selectedMemories: [],
    memoryTrace: [],
    promptPreset: seedPromptPreset(),
    settings: {
      context: settings.context,
      memory: settings.memory,
      energy: settings.energy,
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
    const preset = seedPromptPreset();
    // 即使有人把只读分区的模板改成别的内容，也不能生效。
    preset.sections[0]!.template = "已被篡改";

    const snapshot = buildContext(baseInput({ promptPreset: preset }));

    expect(snapshot.sections[0]?.id).toBe("safety_baseline");
    expect(snapshot.sections[0]?.content).toBe(SAFETY_BASELINE);
    expect(snapshot.renderedInstructions).not.toContain("已被篡改");
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
          energy: settings.energy,
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
          energy: settings.energy,
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
            energy: settings.energy,
          },
        }),
      ),
    ).toThrowError(AppError);
  });

  it("Few-shot 分区排在语气风格之后、能量策略之前", () => {
    const snapshot = buildContext(
      baseInput({ selectedFewShotSamples: [makeFewShotSample()] }),
    );
    const ids = snapshot.sections.map((section) => section.id);

    expect(ids.indexOf("few_shot")).toBeGreaterThan(ids.indexOf("style"));
    expect(ids.indexOf("few_shot")).toBeLessThan(ids.indexOf("energy_policy"));
    expect(snapshot.renderedInstructions).toContain("躺着就躺着吧");
    expect(snapshot.selectedFewShotIds).toEqual(["fs-1"]);
  });

  it("没有样本时整块跳过，不留下空的引导语", () => {
    const snapshot = buildContext(baseInput({ selectedFewShotSamples: [] }));

    expect(snapshot.sections.map((section) => section.id)).not.toContain(
      "few_shot",
    );
    expect(snapshot.renderedInstructions).not.toContain("参考对话");
  });

  it("样本的 note 与 scene 不进入提示词", () => {
    const snapshot = buildContext(
      baseInput({
        selectedFewShotSamples: [
          makeFewShotSample({ note: "这条说明不该出现", scene: "内部场景标签" }),
        ],
      }),
    );

    expect(snapshot.renderedInstructions).not.toContain("这条说明不该出现");
    expect(snapshot.renderedInstructions).not.toContain("内部场景标签");
  });

  it("超出预算时 Few-shot 排在历史之后被裁剪", () => {
    const samples = [
      makeFewShotSample({ id: "fs-1", reply: "示例回复一".repeat(30) }),
      makeFewShotSample({ id: "fs-2", reply: "示例回复二".repeat(30) }),
    ];
    const settings = seedSettings();
    const unconstrained = buildContext(
      baseInput({ selectedFewShotSamples: samples }),
    );

    settings.context.maxTotalChars = unconstrained.charCount - 100;
    const snapshot = buildContext(
      baseInput({
        selectedFewShotSamples: samples,
        settings: {
          context: settings.context,
          memory: settings.memory,
          energy: settings.energy,
        },
      }),
    );

    expect(snapshot.selectedFewShotIds.length).toBeLessThan(samples.length);
    expect(snapshot.renderedInput).toContain("今天好累");
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
