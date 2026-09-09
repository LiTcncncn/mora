import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { TurnPlan } from "@/domain/turn-plan";
import { labelOf, QUESTION_PREFERENCE_LABELS } from "@/lib/labels";
import { HARD_MAX_QUESTIONS_PER_TURN } from "./question-policy";
import {
  renderWorldviewExecutionBlock,
} from "./worldview-turn-plan";

const ENERGY_LABELS: Record<TurnPlan["energy"], string> = {
  E0: "崩溃",
  E1: "0 电量",
  E2: "低电量",
  E3: "中高电量",
};

const WORLDVIEW_HINT: Record<
  Exclude<TurnPlan["worldview"]["mode"], "pending">,
  string
> = {
  W0: "本轮不显性提世界观",
  W1: "W1 一句 ZHAKA 平行感受（回忆/态度，非实时现场）",
  W2: "W2 一小段 ZHAKA 平行感受（回忆/态度，非实时现场）",
  W3: "W3 用户追问设定时才直接回答",
};

/** §12.2：主模型看到的 Turn Plan 文本。 */
export function renderTurnPlanText(
  plan: TurnPlan,
  config: BehaviorConfigV2,
  userMessage?: string,
): string {
  const energyLabel =
    config.energy.budgets[plan.energy].label || ENERGY_LABELS[plan.energy];
  const budget = plan.responseBudget;
  const prefLabel = labelOf(QUESTION_PREFERENCE_LABELS, plan.questionPreference);

  const lines = [
    "【本轮回复计划】",
    `能量：${plan.energy}（${energyLabel}）`,
    `主要策略：${plan.responseMode}`,
    `提问偏好：${prefLabel}（Router 判定）`,
    `重大事件：${plan.majorEvent.matched ? "是" : "否"}`,
    `目标长度：${budget.targetMinChars}–${budget.targetMaxChars} 字，最多 ${budget.maxSentences} 句`,
    `问题：${budget.maxQuestions} 个（全产品每轮最多 ${HARD_MAX_QUESTIONS_PER_TURN} 个）`,
    `新增行动建议：${budget.maxActions} 个`,
    `世界观档位：${plan.worldview.mode}，${
      plan.worldview.mode === "pending"
        ? "待定"
        : WORLDVIEW_HINT[plan.worldview.mode]
    }`,
  ];

  if (plan.questionPreference === "invite" && budget.maxQuestions === 1) {
    lines.push(
      "提问执行：用户邀请提问，本轮必须问一个轻、具体、好答的问题，不可省略。",
    );
  } else if (
    plan.questionPreference === "neutral" &&
    budget.maxQuestions === 1
  ) {
    lines.push(
      "提问执行：neutral 本轮必须问一个轻、具体、好答的问题，不可省略。",
    );
  } else if (budget.maxQuestions === 0) {
    if (plan.questionPreference === "neutral") {
      lines.push("提问执行：neutral 本轮不许向用户提问。");
    } else {
      lines.push("提问执行：本轮不要向用户提问。");
    }
  }

  lines.push(
    `必须做到：${plan.mustDo.join("；")}`,
    `不要做：${plan.mustAvoid.join("；")}`,
  );

  const worldviewBlock = renderWorldviewExecutionBlock(plan, config, userMessage);
  if (worldviewBlock) {
    lines.push("");
    lines.push(worldviewBlock);
  }

  if (plan.selectedExampleId) {
    const card = config.exampleCards.find(
      (item) => item.id === plan.selectedExampleId,
    );
    if (card) {
      lines.push("");
      lines.push(`参考示例 [${card.id}]：${card.name}（仅学口吻，勿覆盖上方世界观）`);
      lines.push(`示范用户：${card.user}`);
      lines.push(`理想回复风格：${card.idealReply}`);
    }
  }

  return lines.join("\n");
}

export function renderResponseContract(
  contract: BehaviorConfigV2["responseContract"],
): string {
  const lines = [
    "输出格式约束（面向语音播报，违反即失败）：",
    "只输出要对用户说的话，必须是可直接朗读的对话正文。",
    "禁止任何括号（含全角（）与半角 ()）及其内容。",
    "禁止舞台指示、动作描写、神态旁白（如「轻轻挪近」「慢悠悠地晃了晃」写成括号或括号外的动作说明）。",
    "禁止输出内部分析、推理过程、元评论、对用户状态的括注说明。",
    "禁止复述或展示【本轮回复计划】里的句子（如「必须问…不可省略」）。",
    contract.forbidHeadings ? "不要使用 Markdown 标题。" : "",
    contract.forbidBulletLists ? "不要使用项目符号列表。" : "",
    contract.forbidInternalAnalysis ? "不要输出内部分析或元评论。" : "",
    contract.forbidRoleLabels
      ? "不要标注角色名前缀（如「ZHAKA：」）。"
      : "",
    `每条回复 emoji 不超过 ${contract.maxEmojiPerReply} 个。`,
  ];
  return lines.filter(Boolean).join("\n");
}
