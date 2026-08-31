import { z } from "zod";
import { responseModeSchema, type ResponseMode } from "./behavior-taxonomy";

/**
 * §8.1 / §8.2：Response Strategy 策略表。
 *
 * 字段分两类（D1）：
 * - `goal`/`mustDo`/`mustAvoid`/`allowInviteOverride` 是**行为规则的权威文本**，
 *   随代码发布，Lab 内只读。开放编辑会重演 Persona 里规则互相冲突、措辞漂移
 *   的问题，而这正是本次优化要消灭的东西。
 * - 其余四项是数值调参，Lab 内可编辑。
 *
 * 两类字段同处一个结构，因此导入外部配置时必须用 `reconcileStrategyPolicies`
 * 把只读字段强制拉回代码常量，否则一份手工编辑过的配置能悄悄改掉行为规则。
 */

export const strategyPolicySchema = z.object({
  id: responseModeSchema,
  goal: z.string().min(1).max(400),
  mustDo: z.array(z.string().min(1).max(200)).max(10),
  mustAvoid: z.array(z.string().min(1).max(200)).max(10),
  defaultMaxQuestions: z.number().int().min(0).max(2),
  defaultMaxActions: z.number().int().min(0).max(2),
  lengthMultiplier: z.number().min(0.3).max(1.5),
  allowWorldview: z.boolean(),
  /** questionPreference=invite 时是否允许把本策略的问题数上限抬到 1（D54） */
  allowInviteOverride: z.boolean(),
}).strict();
export type StrategyPolicy = z.infer<typeof strategyPolicySchema>;

export const strategyPoliciesSchema = z.record(
  responseModeSchema,
  strategyPolicySchema,
);
export type StrategyPolicies = Record<ResponseMode, StrategyPolicy>;

/** 随代码发布的只读部分（§8.1 可编辑范围表）。 */
type StrategyRuleText = Pick<
  StrategyPolicy,
  "goal" | "mustDo" | "mustAvoid" | "allowInviteOverride"
>;

/** Lab 内可编辑的数值部分。 */
type StrategyTunables = Pick<
  StrategyPolicy,
  | "defaultMaxQuestions"
  | "defaultMaxActions"
  | "lengthMultiplier"
  | "allowWorldview"
>;

export const STRATEGY_RULE_TEXTS: Readonly<
  Record<ResponseMode, StrategyRuleText>
> = {
  COMPANION: {
    goal: "回应用户已经说出的具体事情，让这一轮可以自然停住或继续。",
    mustDo: ["回应最具体、最重的部分"],
    mustAvoid: ["原因分析", "无请求建议", "为了续聊而提问"],
    allowInviteOverride: true,
  },
  ASK_LIGHT: {
    goal: "接住用户的表达欲，把话头轻轻递回去。",
    mustDo: ["先接住", "只问一个具体、好答的问题"],
    mustAvoid: ["连续追问", "二选一划分情绪", "用在场承诺挡回去"],
    allowInviteOverride: true,
  },
  DIRECT_ANSWER: {
    goal: "先回答用户明确提出的问题。",
    mustDo: ["把答案放在回复前部", "事实不足时保留不确定性"],
    mustAvoid: [
      "先进行长篇共情",
      "用提问逃避回答",
      "替用户或他人断言动机",
      "在不缺少决定答案的事实时提问",
    ],
    allowInviteOverride: true,
  },
  ONE_STEP_HELP: {
    goal: "给出当前最小、最有用、能执行的一步。",
    mustDo: ["直接给一个动作", "动作与已知现实约束一致"],
    // 最后一条对应 D56：放开 W1 后，风险是比喻替代动作而不是补充动作。
    mustAvoid: [
      "动作链",
      "多个备选",
      "先追问原因",
      "效率说教",
      "以雨林联想代替具体动作",
    ],
    allowInviteOverride: true,
  },
  CONFIRM_CHOICE: {
    goal: "确认用户已经作出的决定。",
    mustDo: ["只确认当前动作"],
    mustAvoid: ["追加第二个动作", "重新替用户选择"],
    allowInviteOverride: false,
  },
  CELEBRATE: {
    goal: "具体地为已经完成或发生的好事高兴。",
    mustDo: ["点出具体完成或好消息"],
    mustAvoid: ["空洞人格夸奖", "补充下一步", "转向改进建议"],
    allowInviteOverride: true,
  },
  REPAIR: {
    goal: "承认具体问题并立即调整或重答。",
    mustDo: ["承认具体偏差", "马上重答或停止"],
    mustAvoid: ["解释内部规则", "分析用户为什么生气", "再次犯同一问题"],
    allowInviteOverride: false,
  },
  CLOSE: {
    goal: "允许对话自然结束。",
    mustDo: ["简短回应结束意图"],
    mustAvoid: ["挽留", "提醒任务", "追加问题", "设置下次钩子"],
    allowInviteOverride: false,
  },
};

/**
 * `allowInviteOverride=false` 的三组：CLOSE、REPAIR、CONFIRM_CHOICE。
 * 它们的 `mustAvoid` 里都写着不要追问，若允许 invite 把问题数抬到 1，
 * 配置就会和自己的行为规则冲突（§13.4 因此有一条对应的硬校验）。
 */
export const INVITE_OVERRIDE_FORBIDDEN_MODES: readonly ResponseMode[] = [
  "CONFIRM_CHOICE",
  "REPAIR",
  "CLOSE",
];

export const DEFAULT_STRATEGY_TUNABLES: Readonly<
  Record<ResponseMode, StrategyTunables>
> = {
  COMPANION: {
    defaultMaxQuestions: 0,
    defaultMaxActions: 0,
    lengthMultiplier: 1,
    allowWorldview: true,
  },
  ASK_LIGHT: {
    defaultMaxQuestions: 1,
    defaultMaxActions: 0,
    lengthMultiplier: 0.8,
    allowWorldview: true,
  },
  DIRECT_ANSWER: {
    defaultMaxQuestions: 1,
    defaultMaxActions: 1,
    lengthMultiplier: 1.1,
    allowWorldview: false,
  },
  // allowWorldview 由 false 改为 true（D56），但受 §9.6 三条额外收窄：
  // 只允许 W1、只在 E1–E3、且必须先给出完整动作。
  ONE_STEP_HELP: {
    defaultMaxQuestions: 0,
    defaultMaxActions: 1,
    lengthMultiplier: 1,
    allowWorldview: true,
  },
  CONFIRM_CHOICE: {
    defaultMaxQuestions: 0,
    defaultMaxActions: 0,
    lengthMultiplier: 0.6,
    allowWorldview: false,
  },
  CELEBRATE: {
    defaultMaxQuestions: 1,
    defaultMaxActions: 0,
    lengthMultiplier: 0.9,
    allowWorldview: true,
  },
  REPAIR: {
    defaultMaxQuestions: 0,
    defaultMaxActions: 0,
    lengthMultiplier: 0.7,
    allowWorldview: false,
  },
  CLOSE: {
    defaultMaxQuestions: 0,
    defaultMaxActions: 0,
    lengthMultiplier: 0.4,
    allowWorldview: false,
  },
};

/**
 * `allowWorldview=false` 的 mode 不产生合格轮，因此既不进入自然世界观频率的
 * 分子也不进入分母（D56 / §9.4）。种子若只标了这些 mode 就永远选不中，
 * §13.4 的死种子校验依赖这个判断。
 */
export function worldviewCapableModes(
  policies: StrategyPolicies,
): ResponseMode[] {
  return responseModeSchema.options.filter(
    (mode) => policies[mode]?.allowWorldview === true,
  );
}

export function buildDefaultStrategyPolicies(): StrategyPolicies {
  return Object.fromEntries(
    responseModeSchema.options.map((mode) => [
      mode,
      {
        id: mode,
        ...STRATEGY_RULE_TEXTS[mode],
        ...DEFAULT_STRATEGY_TUNABLES[mode],
      } satisfies StrategyPolicy,
    ]),
  ) as StrategyPolicies;
}

export interface StrategyReconcileNote {
  mode: ResponseMode;
  field: keyof StrategyRuleText;
}

/**
 * 用代码常量覆盖只读字段，保留导入文件里的数值调参。
 *
 * 覆盖而不是拒绝整包：只读字段不一致最常见的原因是导入了一份旧版本导出的配置，
 * 那时的规则文本本就不同。拒绝会让回滚场景无法进行，而静默接受会让一份文件
 * 悄悄改掉行为规则——两者都不可接受，所以覆盖并在预览中列出。
 */
export function reconcileStrategyPolicies(
  incoming: Partial<Record<ResponseMode, StrategyPolicy>>,
): { policies: StrategyPolicies; notes: StrategyReconcileNote[] } {
  const notes: StrategyReconcileNote[] = [];
  const defaults = buildDefaultStrategyPolicies();

  const policies = Object.fromEntries(
    responseModeSchema.options.map((mode) => {
      const source = incoming[mode];
      if (!source) return [mode, defaults[mode]];

      const ruleText = STRATEGY_RULE_TEXTS[mode];
      const differs: Array<keyof StrategyRuleText> = [];
      if (source.goal !== ruleText.goal) differs.push("goal");
      if (!sameStringList(source.mustDo, ruleText.mustDo)) differs.push("mustDo");
      if (!sameStringList(source.mustAvoid, ruleText.mustAvoid)) {
        differs.push("mustAvoid");
      }
      if (source.allowInviteOverride !== ruleText.allowInviteOverride) {
        differs.push("allowInviteOverride");
      }
      for (const field of differs) notes.push({ mode, field });

      return [
        mode,
        {
          id: mode,
          ...ruleText,
          defaultMaxQuestions: source.defaultMaxQuestions,
          defaultMaxActions: source.defaultMaxActions,
          lengthMultiplier: source.lengthMultiplier,
          allowWorldview: source.allowWorldview,
        } satisfies StrategyPolicy,
      ];
    }),
  ) as StrategyPolicies;

  return { policies, notes };
}

function sameStringList(a: string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
