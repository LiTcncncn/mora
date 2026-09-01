import { randomUUID } from "node:crypto";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { Conversation } from "@/domain/conversation";
import type { EnergyResolution } from "@/domain/energy";
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
import type { TurnPlan } from "@/domain/turn-plan";
import { assertTurnPlanReadyForContext } from "@/domain/turn-plan";
import { selectLaneMessages } from "@/domain/conversation";
import { AppError } from "../api/errors";
import { estimateTokens, sha256 } from "../observability/hash";
import { getSafetyBaselineSection } from "@/domain/safety";
import {
  renderResponseContract,
  renderTurnPlanText,
} from "../policy/render-turn-plan";
import {
  limitHistory,
  renderHistory,
  renderMemories,
  renderPersonaTraits,
} from "./renderers";

export interface BuildContextInput {
  modelSlotId: string;
  userMessage: string;
  conversation: Conversation;
  persona: Persona;
  turnPlan: TurnPlan;
  behaviorConfig: BehaviorConfigV2;
  energyResolution: EnergyResolution;
  selectedMemories: MemoryItem[];
  memoryTrace: MemorySelectionTrace[];
  promptPreset: PromptPreset;
  settings: Pick<SettingsData, "context" | "memory">;
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
  "turn_plan",
  "memory",
  "response_contract",
  "custom_experiment",
];

/** v2 运行时由编译器提供，不再读 preset 里的旧分区。 */
const PRESET_SECTIONS_MANAGED_BY_V2 = new Set<ContextSectionId>([
  "safety_baseline",
  "energy_policy",
  "response_contract",
  "turn_plan",
]);

function orderedSectionIds(
  settings: BuildContextInput["settings"],
  preset: PromptPreset,
): ContextSectionId[] {
  const available = new Set(
    preset.sections
      .map((section) => section.id)
      .filter((id) => !PRESET_SECTIONS_MANAGED_BY_V2.has(id)),
  );
  const configured = settings.context.sectionOrder.filter(
    (id) => available.has(id) && !PRESET_SECTIONS_MANAGED_BY_V2.has(id),
  );
  const missing = [...available].filter((id) => !configured.includes(id));

  const ordered = [...configured, ...missing];
  if (!ordered.includes("turn_plan")) {
    const styleIndex = ordered.indexOf("style");
    if (styleIndex >= 0) {
      ordered.splice(styleIndex + 1, 0, "turn_plan");
    } else {
      const personaIndex = ordered.indexOf("persona");
      ordered.splice(personaIndex >= 0 ? personaIndex + 1 : 0, 0, "turn_plan");
    }
  }
  if (!ordered.includes("response_contract")) {
    ordered.push("response_contract");
  }

  return ordered;
}

export function buildContext(input: BuildContextInput): ContextSnapshot {
  assertTurnPlanReadyForContext(input.turnPlan);

  const {
    modelSlotId,
    userMessage,
    conversation,
    persona,
    turnPlan,
    behaviorConfig,
    energyResolution,
    selectedMemories,
    memoryTrace,
    promptPreset,
    settings,
  } = input;

  const laneMessages = selectLaneMessages(conversation, modelSlotId);
  let history = limitHistory(laneMessages, settings.context);
  let memories = [...selectedMemories];
  let customBlockEnabled = settings.context.customExperimentBlockEnabled;
  let customBlockDisabledReason: string | null = null;

  const sectionById = new Map(
    promptPreset.sections.map((section) => [section.id, section]),
  );

  for (const section of promptPreset.sections) {
    if (!section.editable) continue;
    if (PRESET_SECTIONS_MANAGED_BY_V2.has(section.id)) continue;
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
  } => {
    const values: Record<TemplateVariable, string> = {
      "persona.name": persona.name,
      "persona.corePrompt": persona.corePrompt,
      "persona.renderedTraits": renderPersonaTraits(persona),
      "energy.level": energyResolution.level,
      "energy.policy": renderTurnPlanText(turnPlan, behaviorConfig, userMessage),
      "memory.rendered": renderMemories(memories, settings.context),
      "history.rendered": renderHistory(history, settings.context),
      "user.message": userMessage,
    };

    const baseline = getSafetyBaselineSection();
    const rendered: RenderedSection[] = [
      {
        id: "safety_baseline",
        title: baseline.title,
        content: baseline.content,
        sourceIds: [],
      },
    ];

    for (const id of orderedSectionIds(settings, promptPreset)) {
      if (id === "turn_plan") {
        rendered.push({
          id: "turn_plan",
          title: "本轮回复计划",
          content: renderTurnPlanText(turnPlan, behaviorConfig, userMessage),
          sourceIds: [],
        });
        continue;
      }

      if (id === "response_contract") {
        rendered.push({
          id: "response_contract",
          title: "输出格式约束",
          content: renderResponseContract(behaviorConfig.responseContract),
          sourceIds: [],
        });
        continue;
      }

      const section = sectionById.get(id);
      if (!section) continue;
      if (!section.enabled) continue;
      if (id === "custom_experiment" && !customBlockEnabled) continue;
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

    return { sections: rendered, instructions, inputText };
  };

  let attempt = buildAttempt();
  const overBudget = () =>
    [...attempt.instructions].length + [...attempt.inputText].length >
    settings.context.maxTotalChars;

  while (overBudget() && memories.length > 0) {
    memories = memories.slice(0, -1);
    attempt = buildAttempt();
  }
  while (overBudget() && history.length > 0) {
    history = history.slice(1);
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
    configHash: behaviorConfig.configHash,
  });

  const hash = sha256({
    sections: attempt.sections.map((section) => ({
      id: section.id,
      content: section.content,
    })),
    userMessage,
    energyLevel: energyResolution.level,
    configHash: behaviorConfig.configHash,
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
    behaviorConfigHash: behaviorConfig.configHash,
    turnPlan,
    turnRoutingSource: undefined,
  };
}

/** 后置观察：对照 v2 Turn Plan 预算，不截断模型输出。 */
export function measureTurnPlanDeviation(
  outputText: string,
  plan: TurnPlan,
): {
  targetMaxChars: number;
  actualChars: number;
  targetMaxSentences: number;
  actualSentences: number;
  maxQuestions: number;
  actualQuestions: number;
  withinTarget: boolean;
} {
  const actualChars = [...outputText].length;
  const actualSentences = outputText
    .split(/[。！？!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const actualQuestions = (outputText.match(/[?？]/g) ?? []).length;
  const budget = plan.responseBudget;

  return {
    targetMaxChars: budget.targetMaxChars,
    actualChars,
    targetMaxSentences: budget.maxSentences,
    actualSentences,
    maxQuestions: budget.maxQuestions,
    actualQuestions,
    withinTarget:
      actualChars <= budget.targetMaxChars &&
      actualSentences <= budget.maxSentences &&
      actualQuestions <= budget.maxQuestions,
  };
}
