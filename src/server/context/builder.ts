import { randomUUID } from "node:crypto";
import type { Conversation, ConversationMessage } from "@/domain/conversation";
import type { EnergyResolution } from "@/domain/energy";
import type { FewShotSample, FewShotSelectionTrace } from "@/domain/fewshot";
import type { MemoryItem, MemorySelectionTrace } from "@/domain/memory";
import type { Persona } from "@/domain/persona";
import {
  renderTemplate,
  validateTemplate,
  type ContextSectionId,
  type PromptPreset,
  type TemplateVariable,
} from "@/domain/prompt";
import type {
  ContextSectionSnapshot,
  ContextSnapshot,
} from "@/domain/run";
import type { SettingsData } from "@/domain/settings";
import { selectLaneMessages } from "@/domain/conversation";
import { AppError } from "../api/errors";
import { renderEnergyPolicy } from "../energy/resolver";
import { estimateTokens, sha256 } from "../observability/hash";
import { getSafetyBaselineSection } from "@/domain/safety";
import {
  limitHistory,
  renderFewShot,
  renderHistory,
  renderMemories,
  renderPersonaTraits,
} from "./renderers";

export interface BuildContextInput {
  modelSlotId: string;
  userMessage: string;
  conversation: Conversation;
  persona: Persona;
  energyResolution: EnergyResolution;
  selectedMemories: MemoryItem[];
  memoryTrace: MemorySelectionTrace[];
  selectedFewShotSamples?: FewShotSample[];
  fewShotTrace?: FewShotSelectionTrace[];
  promptPreset: PromptPreset;
  settings: Pick<SettingsData, "context" | "memory" | "energy">;
}

interface RenderedSection {
  id: ContextSectionId;
  title: string;
  content: string;
  sourceIds: string[];
}

const INSTRUCTION_SECTIONS: ContextSectionId[] = [
  "safety_baseline",
  "persona",
  "style",
  "few_shot",
  "energy_policy",
  "memory",
  "response_contract",
  "custom_experiment",
];

function orderedSectionIds(
  settings: BuildContextInput["settings"],
  preset: PromptPreset,
): ContextSectionId[] {
  const available = new Set(preset.sections.map((section) => section.id));
  const configured = settings.context.sectionOrder.filter((id) =>
    available.has(id),
  );
  const missing = preset.sections
    .map((section) => section.id)
    .filter((id) => !configured.includes(id));
  const combined = [...configured, ...missing];

  // 安全底线永远排在最前。
  return [
    "safety_baseline",
    ...combined.filter((id) => id !== "safety_baseline"),
  ];
}

export function buildContext(input: BuildContextInput): ContextSnapshot {
  const {
    modelSlotId,
    userMessage,
    conversation,
    persona,
    energyResolution,
    selectedMemories,
    memoryTrace,
    promptPreset,
    settings,
  } = input;

  const fewShotTrace = input.fewShotTrace ?? [];

  const laneMessages = selectLaneMessages(conversation, modelSlotId);
  let history = limitHistory(laneMessages, settings.context);
  let memories = [...selectedMemories];
  let fewShotSamples = [...(input.selectedFewShotSamples ?? [])];
  let customBlockEnabled = settings.context.customExperimentBlockEnabled;
  let customBlockDisabledReason: string | null = null;

  const sectionById = new Map(
    promptPreset.sections.map((section) => [section.id, section]),
  );

  for (const section of promptPreset.sections) {
    if (!section.editable) continue;
    const validation = validateTemplate(section.template);
    if (!validation.ok) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Prompt 分区「${section.title}」包含未知变量：${validation.unknownVariables.join(", ")}`,
      );
    }
  }

  const buildAttempt = (): {
    sections: RenderedSection[];
    instructions: string;
    inputText: string;
    historyUsed: ConversationMessage[];
  } => {
    const values: Record<TemplateVariable, string> = {
      "persona.name": persona.name,
      "persona.corePrompt": persona.corePrompt,
      "persona.renderedTraits": renderPersonaTraits(persona),
      "energy.level": energyResolution.level,
      "energy.policy": renderEnergyPolicy(
        energyResolution.level,
        settings.energy,
        {
          includeReason: settings.context.includeEnergyReason,
          reason: energyResolution.reason,
        },
      ),
      "fewshot.rendered": renderFewShot(fewShotSamples),
      "memory.rendered": renderMemories(memories, settings.context),
      "history.rendered": renderHistory(history, settings.context),
      "user.message": userMessage,
    };

    const rendered: RenderedSection[] = [];
    for (const id of orderedSectionIds(settings, promptPreset)) {
      const section = sectionById.get(id);
      if (!section) continue;

      if (id === "safety_baseline") {
        // 安全底线内容永远来自服务端常量，忽略存储模板，无法被编辑或导入覆盖。
        const baseline = getSafetyBaselineSection();
        rendered.push({
          id,
          title: baseline.title,
          content: baseline.content,
          sourceIds: [],
        });
        continue;
      }

      if (!section.enabled) continue;
      if (id === "custom_experiment" && !customBlockEnabled) continue;
      // 没有样本时整块跳过，避免只留下一句没有内容的引导语。
      if (id === "few_shot" && fewShotSamples.length === 0) continue;
      if (id === "memory" && memories.length === 0 && !settings.memory.enabled) {
        continue;
      }

      const content = renderTemplate(section.template, values).trim();
      if (!content) continue;

      rendered.push({
        id,
        title: section.title,
        content,
        sourceIds:
          id === "memory"
            ? memories.map((memory) => memory.id)
            : id === "few_shot"
              ? fewShotSamples.map((sample) => sample.id)
              : id === "history"
                ? history.map((message) => message.id)
                : [],
      });
    }

    const instructions = rendered
      .filter((section) => INSTRUCTION_SECTIONS.includes(section.id))
      .map((section) => `## ${section.title}\n${section.content}`)
      .join("\n\n");

    const historySection = rendered.find((section) => section.id === "history");
    const inputText = [
      historySection
        ? `## ${historySection.title}\n${historySection.content}`
        : "",
      `## 用户当前这句话\n${userMessage}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return { sections: rendered, instructions, inputText, historyUsed: history };
  };

  let attempt = buildAttempt();
  const overBudget = () =>
    [...attempt.instructions].length + [...attempt.inputText].length >
    settings.context.maxTotalChars;

  // 裁剪优先级：Memory（低分先移除）→ 历史（最旧先移除）→ Few-shot（相关度最低先移除）
  // → 自定义实验分区 → 报错。
  while (overBudget() && memories.length > 0) {
    memories = memories.slice(0, -1);
    attempt = buildAttempt();
  }
  while (overBudget() && history.length > 0) {
    history = history.slice(1);
    attempt = buildAttempt();
  }
  while (overBudget() && fewShotSamples.length > 0) {
    fewShotSamples = fewShotSamples.slice(0, -1);
    attempt = buildAttempt();
  }
  if (overBudget() && customBlockEnabled) {
    customBlockEnabled = false;
    customBlockDisabledReason = "自定义实验分区因超出上下文预算被本轮禁用";
    attempt = buildAttempt();
  }
  if (overBudget()) {
    throw new AppError(
      "CONTEXT_BUDGET_EXCEEDED",
      `上下文超出预算（maxTotalChars=${settings.context.maxTotalChars}），已停止构建，不做隐式截断`,
    );
  }

  const sections: ContextSectionSnapshot[] = attempt.sections.map((section) => ({
    id: section.id,
    title: section.title,
    content: section.content,
    charCount: [...section.content].length,
    estimatedTokens: estimateTokens(section.content),
    sourceIds: section.sourceIds,
  }));

  sections.push({
    id: "user_input",
    title: "用户当前这句话",
    content: userMessage,
    charCount: [...userMessage].length,
    estimatedTokens: estimateTokens(userMessage),
    sourceIds: [],
  });

  if (customBlockDisabledReason) {
    sections.push({
      id: "custom_experiment",
      title: "自定义实验分区（本轮已禁用）",
      content: customBlockDisabledReason,
      charCount: [...customBlockDisabledReason].length,
      estimatedTokens: 0,
      sourceIds: [],
    });
  }

  const sharedPayload = attempt.sections
    .filter((section) => section.id !== "history")
    .map((section) => ({ id: section.id, content: section.content }));

  const sharedHash = sha256({
    sections: sharedPayload,
    userMessage,
    energyLevel: energyResolution.level,
  });

  const hash = sha256({
    sections: attempt.sections.map((section) => ({
      id: section.id,
      content: section.content,
    })),
    userMessage,
    energyLevel: energyResolution.level,
  });

  const charCount =
    [...attempt.instructions].length + [...attempt.inputText].length;

  return {
    id: `ctx-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    modelSlotId,
    sections,
    renderedInstructions: attempt.instructions,
    renderedInput: attempt.inputText,
    selectedMemoryIds: memories.map((memory) => memory.id),
    memorySelectionTrace: memoryTrace,
    selectedFewShotIds: fewShotSamples.map((sample) => sample.id),
    fewShotSelectionTrace: fewShotTrace,
    energy: {
      level: energyResolution.level,
      source: energyResolution.source,
      reason: energyResolution.reason,
    },
    charCount,
    estimatedTokens: estimateTokens(
      `${attempt.instructions}\n${attempt.inputText}`,
    ),
    sharedHash,
    hash,
  };
}
