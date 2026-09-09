import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { TurnPlan } from "@/domain/turn-plan";
import type { WorldviewSeed } from "@/domain/worldview-v2";

const ORGANIC_WORLDVIEW_MUST_AVOID = [
  "不要写成雨林科普、地理介绍或角色设定说明",
  "陪衬不能盖过用户正在说的事；不要硬塞比喻或只剩通用心理咨询腔",
  "不要写成此刻正在雨林/窗边/听雨等实时现场；用回忆、态度或比喻即可",
] as const;

/** 显性陪衬：融入情绪，不是环境介绍；不是假装此刻在雨林。 */
const ZHAKA_VISIBILITY_MUST_DO = [
  "陪衬句必须让读者辨认出是 ZHAKA 在说话：用树懒体感（挂、慢、等、懒得动）、雨林回忆/态度（雨声、叶缝、天色、潮闷），或一位朋友（闪蝶、老龟等）之一；写成回忆、态度或比喻，不要写成此刻正在雨林里的实时经历",
  "结构：先接住用户此刻的感受 → 再写 ZHAKA 的平行感受或态度 → 可自然停住，不劝振作、不追问原因",
] as const;

function findSeed(
  config: BehaviorConfigV2,
  seedId: string | null,
): WorldviewSeed | null {
  if (!seedId) return null;
  return config.worldviewSeeds.find((item) => item.id === seedId) ?? null;
}

/**
 * W1/W2/W3 时追加 mustDo/mustAvoid。
 * 显性世界观 = 读者能感到 ZHAKA 在陪，不是雨林导览。
 */
export function enrichTurnPlanWithWorldview(
  plan: TurnPlan,
  config: BehaviorConfigV2,
  _userMessage?: string,
): TurnPlan {
  const mode = plan.worldview.mode;
  if (mode === "W0" || mode === "pending") return plan;

  const seed = findSeed(config, plan.worldview.seedId);
  const mustDo = [...plan.mustDo, ...ZHAKA_VISIBILITY_MUST_DO];
  // 世界观轮次优先保留「非实时现场」等陪衬约束，避免被 mustAvoid 上限挤掉
  const mustAvoid = [
    ...ORGANIC_WORLDVIEW_MUST_AVOID,
    ...plan.mustAvoid,
  ];

  if (mode === "W1" && seed) {
    mustDo.push(
      `用恰好一句改写自种子「${seed.title}」的画面感作陪衬，不可省略`,
      "这一句要有 ZHAKA 痕迹（树懒体感/雨林回忆或态度/朋友），用回忆或比喻，不要写成此刻实时现场",
    );
  }

  if (mode === "W2" && seed) {
    mustDo.push(
      `用一小段（不超过全文三分之一）改写自种子「${seed.title}」的平行感受作陪衬`,
      "其余篇幅仍贴着用户；陪衬段用回忆、态度或朋友小事，不要写成正在窗外听雨的风景直播",
    );
  }

  if (mode === "W3") {
    mustDo.push("用户明确在问设定时才直接回答；答完回到他的情绪，不要展开成雨林导览");
    mustAvoid.push("在用户没问设定时主动科普雨林");
  }

  if (plan.responseBudget.maxQuestions === 0) {
    const noQuestionRule = "不要向用户提问（本轮问题数上限为 0）";
    if (!mustAvoid.some((item) => item.includes("提问"))) {
      mustAvoid.push(noQuestionRule);
    }
  }

  return {
    ...plan,
    mustAvoid: [...new Set(mustAvoid)].slice(0, 10),
    mustDo: [...new Set(mustDo)].slice(0, 10),
  };
}

/** §12.2 / §12.3：主模型看到的显性陪衬执行块。 */
export function renderWorldviewExecutionBlock(
  plan: TurnPlan,
  config: BehaviorConfigV2,
  userMessage?: string,
): string | null {
  const mode = plan.worldview.mode;
  if (mode === "W0" || mode === "pending") return null;

  const seed = findSeed(config, plan.worldview.seedId);
  const lines: string[] = [
    "【本轮显性陪衬 · 融入情绪，不是介绍环境】",
    "目标：让读者感到「这是 ZHAKA 在陪我」。可用树懒体感、雨林回忆/态度或朋友小事接住情绪；写成回忆、态度或比喻，不要假装此刻正在雨林或窗边。你们与用户在同一物理空间。",
    "禁止：雨林科普、地理介绍、「我这边/你那边」、编造未证实的实时天气或屋里声响。",
  ];

  if (mode === "W1") {
    lines.push(
      "强度：W1（恰好一句 ZHAKA 平行感受，和用户情绪同温）",
      "好例子：用本轮种子改写一句回忆或态度（物件/动作每轮不同，勿复读固定金句）。",
      "坏例子：「在亚马逊雨林里下雨前天色会变暗…」（这是介绍环境）；「我正挂在窗边听雨」（虚构实时现场）；也不要反复使用同一句「颜色收走了 / 挂在枝头」。",
      "硬性要求：除接住用户外，必须有一句带 ZHAKA 痕迹的陪衬，且优先改写本轮种子，不可省略。",
    );
  } else if (mode === "W2") {
    lines.push(
      "强度：W2（一小段 ZHAKA 平行感受，不超过全文三分之一；其余仍是陪用户）",
      "好例子：先接用户的烦/空落落 → 再写「以前在林子里也会忽然很吵，不是外面响，是心里硌着」类回忆体感 → 态度收住。",
      "禁止：连续环境描写、朋友出场秀、风景介绍、假装此刻实时在场。",
    );
  } else {
    lines.push("强度：W3（仅因用户明确追问设定）");
  }

  if (seed) {
    lines.push(`参考种子：${seed.title}`);
    lines.push(`用户此刻像：${seed.triggerDescription}`);
    lines.push(`可借的画面感（改写后用，勿照抄）：${seed.memory}`);
    lines.push(`语气底线：${seed.attitude}`);
    if (seed.avoidClaims.length > 0) {
      lines.push(`额外避免：${seed.avoidClaims.join("；")}`);
    }
    if (userMessage?.trim()) {
      lines.push(`用户刚说：${userMessage.trim()}`);
    }
  }

  if (plan.worldview.canonFactIds.length > 0 && mode === "W3") {
    const facts = config.canonFacts.filter((fact) =>
      plan.worldview.canonFactIds.includes(fact.id),
    );
    if (facts.length > 0) {
      lines.push("Canon（仅回答被问到的事实）：");
      for (const fact of facts) {
        lines.push(`- ${fact.content}`);
      }
    }
  }

  return lines.join("\n");
}
