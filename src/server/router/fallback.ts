import type { RequestFlagSettings } from "@/domain/behavior-config";
import type { EnergyLevel } from "@/domain/common";
import type {
  TurnRouterInput,
  TurnRoutingResult,
} from "@/domain/turn-routing";
import { resolveRequestFlagsByRules } from "./request-flags";

function resolveQuestionPreference(text: string): TurnRoutingResult["questionPreference"] {
  if (/别问|不要问|别再问|不想被问/.test(text)) {
    return { value: "avoid", confidence: 0.85, evidence: ["用户拒绝被问"] };
  }
  if (/你觉得呢|你怎么看|想听听你|想和你聊|陪我说说/.test(text)) {
    return { value: "invite", confidence: 0.75, evidence: ["用户邀请继续聊"] };
  }
  return { value: "neutral", confidence: 0.6, evidence: [] };
}

function resolveResponseMode(text: string): TurnRoutingResult["responseMode"] {
  if (/睡了|改天|不聊了|先这样|明天再说/.test(text)) {
    return { value: "CLOSE", confidence: 0.9, evidence: ["结束对话"] };
  }
  if (/像客服|套话|你没懂|重新说|别分析了/.test(text)) {
    return { value: "REPAIR", confidence: 0.85, evidence: ["要求修复回复"] };
  }
  if (/那我先|我决定|我打算就|我去.{0,4}了/.test(text)) {
    return { value: "CONFIRM_CHOICE", confidence: 0.8, evidence: ["确认选择"] };
  }
  if (/好消息|完成了|终于|太棒了|通过了/.test(text)) {
    return { value: "CELEBRATE", confidence: 0.85, evidence: ["分享好消息"] };
  }
  if (/怎么办|怎么做|给我步骤|帮我.{0,6}一下|我该怎么/.test(text)) {
    return { value: "ONE_STEP_HELP", confidence: 0.75, evidence: ["求具体帮助"] };
  }
  // 用户把话题权交给 ZHAKA：走 COMPANION，由 casual-chat 约束强制贡献内容
  if (
    /你说点|你讲[一点个]|你来[说讲聊]|你起头|你说吧|你来吧|聊点怪|讲[一点个]好玩|说[一点个]好玩|讲个故事|说个故事|你先说|给我讲/.test(
      text,
    )
  ) {
    return {
      value: "COMPANION",
      confidence: 0.85,
      evidence: ["用户把话题权交给 ZHAKA"],
    };
  }
  if (
    /很闲|好闲|没事干|不知道聊什么|没话题|无聊|闲着|不知道说什么|不知道讲什么/.test(
      text,
    )
  ) {
    return {
      value: "COMPANION",
      confidence: 0.75,
      evidence: ["闲聊无话题"],
    };
  }
  if (/\?|？|吗$|么$|什么|为什么|怎么|哪/.test(text)) {
    return { value: "DIRECT_ANSWER", confidence: 0.65, evidence: ["明确提问"] };
  }
  if (/想聊|说说|陪/.test(text)) {
    return { value: "ASK_LIGHT", confidence: 0.6, evidence: ["轻邀请"] };
  }
  return { value: "COMPANION", confidence: 0.55, evidence: [] };
}

function resolveEnergy(
  text: string,
  previousEnergy: EnergyLevel | null,
): TurnRoutingResult["energy"] {
  if (/好累|累死了|没力气|不想动|撑不住|快撑不住/.test(text)) {
    return { level: "E1", confidence: 0.75, evidence: ["低能量"] };
  }
  if (previousEnergy) {
    return {
      level: previousEnergy,
      confidence: 0.6,
      evidence: [`沿用上一轮 ${previousEnergy}`],
    };
  }
  return { level: "E2", confidence: 0.5, evidence: ["默认 E2"] };
}

function resolveWorldviewRelation(text: string): TurnRoutingResult["worldviewRelation"] {
  if (/ZHAKA|MORA|亚马逊|雨林|树懒|你.{0,2}哪出生|你.{0,2}朋友/.test(text)) {
    return {
      level: "required",
      tags: [],
      referencedEntities: [],
      confidence: 0.85,
      evidence: ["追问世界观"],
    };
  }
  if (/别讲树懒|不要角色|直接回答|别比喻/.test(text)) {
    return {
      level: "discouraged",
      tags: [],
      referencedEntities: [],
      confidence: 0.85,
      evidence: ["用户拒绝角色化"],
    };
  }
  return {
    level: "eligible",
    tags: [],
    referencedEntities: [],
    confidence: 0.4,
    evidence: [],
  };
}

function resolveMajorEvent(text: string): TurnRoutingResult["majorEvent"] {
  if (/分手|离婚|被裁|失业|去世|确诊|破产|失去/.test(text)) {
    return {
      matched: true,
      type: "other_major_loss",
      temporalStatus: "occurred",
      subject: "user",
      evidence: ["重大负面事件措辞"],
    };
  }
  return {
    matched: false,
    type: null,
    temporalStatus: null,
    subject: null,
    evidence: [],
  };
}

/** §7.8：Router 确定性回退。 */
export function classifyTurnFallback(
  input: TurnRouterInput,
  requestFlagSettings: RequestFlagSettings,
): TurnRoutingResult {
  const text = input.currentUserMessage.trim();
  const questionPreference = resolveQuestionPreference(text);
  const responseMode = resolveResponseMode(text);
  const energy = resolveEnergy(text, input.previousEnergy);
  const worldviewRelation = resolveWorldviewRelation(text);
  const majorEvent = resolveMajorEvent(text);
  const requestFlags = resolveRequestFlagsByRules(text, requestFlagSettings);

  return {
    source: "fallback",
    energy,
    majorEvent,
    questionPreference,
    responseMode,
    worldviewRelation,
    requestFlags,
    overallConfidence: Math.min(
      questionPreference.confidence,
      responseMode.confidence,
      energy.confidence,
    ),
  };
}

/** router.mode=fixed 时的保守默认。 */
export function classifyTurnFixed(): TurnRoutingResult {
  return {
    source: "fixed",
    energy: { level: "E2", confidence: 1, evidence: ["fixed"] },
    majorEvent: {
      matched: false,
      type: null,
      temporalStatus: null,
      subject: null,
      evidence: [],
    },
    questionPreference: { value: "neutral", confidence: 1, evidence: ["fixed"] },
    responseMode: { value: "COMPANION", confidence: 1, evidence: ["fixed"] },
    worldviewRelation: {
      level: "eligible",
      tags: [],
      referencedEntities: [],
      confidence: 1,
      evidence: ["fixed"],
    },
    requestFlags: {
      wantsDetailedAnswer: false,
      wantsMultiStepPlan: false,
      source: "fallback",
      evidence: [],
    },
    overallConfidence: 1,
  };
}

export function classifyTurnRules(
  input: TurnRouterInput,
  requestFlagSettings: RequestFlagSettings,
): TurnRoutingResult {
  const result = classifyTurnFallback(input, requestFlagSettings);
  return { ...result, source: "rules" };
}
