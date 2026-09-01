import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { TurnPlan } from "@/domain/turn-plan";
import type { SafetyResolution, TurnRoutingResult } from "@/domain/turn-routing";

/** §9.4：判定本轮是否为合格轮（调度分母）。 */
export function evaluateEligibleTurn(input: {
  routing: TurnRoutingResult;
  safety: SafetyResolution;
  plan: TurnPlan;
  config: BehaviorConfigV2;
  stage1CandidateCount: number;
}): { eligible: boolean; reason: string | null } {
  const { routing, safety, plan, config, stage1CandidateCount } = input;

  if (routing.worldviewRelation.level === "required") {
    return { eligible: false, reason: "required 走 W3，不计入自然调度合格轮" };
  }
  if (routing.worldviewRelation.level === "discouraged") {
    return { eligible: false, reason: "用户要求无角色化回答" };
  }
  if (routing.worldviewRelation.level !== "eligible") {
    return { eligible: false, reason: "worldviewRelation 非 eligible" };
  }
  if (safety.route === "urgent_support") {
    return { eligible: false, reason: "Safety urgent" };
  }
  if (plan.majorEvent.firstMention) {
    return { eligible: false, reason: "重大事件首次出现" };
  }
  if (plan.responseMode === "REPAIR" || plan.responseMode === "CLOSE") {
    return { eligible: false, reason: `策略 ${plan.responseMode} 非合格轮` };
  }
  const policy = config.strategies[plan.responseMode];
  if (!policy.allowWorldview) {
    return { eligible: false, reason: `策略 ${plan.responseMode} 禁用世界观` };
  }
  if (plan.responseMode === "ONE_STEP_HELP" && plan.energy === "E0") {
    return { eligible: false, reason: "ONE_STEP_HELP + E0 非合格轮" };
  }
  if (stage1CandidateCount === 0) {
    return { eligible: false, reason: "第一段种子过滤后无候选" };
  }
  return { eligible: true, reason: null };
}
