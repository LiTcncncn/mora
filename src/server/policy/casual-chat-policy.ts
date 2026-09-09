import type { TurnPlan } from "@/domain/turn-plan";

/**
 * 用户把话题权交给 ZHAKA：要主动贡献内容，而不是再把球踢回去。
 */
export function isTopicHandoff(text: string): boolean {
  return /你说点|你讲[一点个]|你来[说讲聊]|你起头|你说吧|你来吧|聊点怪|讲[一点个]好玩|说[一点个]好玩|讲个故事|说个故事|你贡献|随便说点|你先说|你丢[一点个]|给我讲/.test(
    text,
  );
}

/**
 * 无情绪载荷的闲置 / 不知道聊什么：避免许可式陪伴腔。
 */
export function isIdleCasualChat(text: string): boolean {
  if (isTopicHandoff(text)) return false;
  return /很闲|好闲|没事干|不知道聊什么|没话题|无聊|闲着|不知道说什么|不知道讲什么/.test(
    text,
  );
}

const TOPIC_HANDOFF_MUST_DO =
  "用户把话题权交给你：主动贡献一段短内容（真实趣闻、小故事、观察、观点或自然联想），至少含一句可感知的具体事实或细节，不要只抛问题";

const TOPIC_HANDOFF_MUST_AVOID =
  "把话题再丢回用户（你呢／你想听什么／你起头／你说）";

const IDLE_CASUAL_MUST_DO =
  "短、平、像室友闲聊接一句即可；不要写成情绪安抚或在场宣告";

const IDLE_CASUAL_MUST_AVOID =
  "许可式陪伴套话（闲也挺好／不用硬找话题／我就待着／你想说再说）";

/**
 * 在基础 Turn Plan 上叠加闲聊 / 话题交接约束。
 * 不改变 responseMode，只收紧 mustDo / mustAvoid / 提问与篇幅。
 */
export function applyCasualChatOverrides(
  plan: TurnPlan,
  userMessage: string,
): TurnPlan {
  if (plan.responseMode === "CLOSE" || plan.responseMode === "REPAIR") {
    return plan;
  }

  if (isTopicHandoff(userMessage)) {
    const mustDo = [
      TOPIC_HANDOFF_MUST_DO,
      ...plan.mustDo.filter((line) => line !== TOPIC_HANDOFF_MUST_DO),
    ].slice(0, 10);
    const mustAvoid = [
      TOPIC_HANDOFF_MUST_AVOID,
      ...plan.mustAvoid.filter((line) => line !== TOPIC_HANDOFF_MUST_AVOID),
    ].slice(0, 10);
    return {
      ...plan,
      responseBudget: {
        ...plan.responseBudget,
        maxQuestions: 0,
        // 允许一小段内容，但仍克制
        targetMinChars: Math.min(plan.responseBudget.targetMinChars, 60),
        targetMaxChars: Math.max(
          plan.responseBudget.targetMaxChars,
          Math.min(plan.responseBudget.hardMaxChars, 220),
        ),
      },
      mustDo,
      mustAvoid,
    };
  }

  if (isIdleCasualChat(userMessage) && plan.responseMode === "COMPANION") {
    const mustDo = [
      IDLE_CASUAL_MUST_DO,
      ...plan.mustDo.filter((line) => line !== IDLE_CASUAL_MUST_DO),
    ].slice(0, 10);
    const mustAvoid = [
      IDLE_CASUAL_MUST_AVOID,
      ...plan.mustAvoid.filter((line) => line !== IDLE_CASUAL_MUST_AVOID),
    ].slice(0, 10);
    return {
      ...plan,
      responseBudget: {
        ...plan.responseBudget,
        maxQuestions: Math.min(plan.responseBudget.maxQuestions, 0),
        targetMaxChars: Math.min(plan.responseBudget.targetMaxChars, 90),
        maxSentences: Math.min(plan.responseBudget.maxSentences, 2),
      },
      mustDo,
      mustAvoid,
    };
  }

  return plan;
}
