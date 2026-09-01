import type { EnergyLevel } from "@/domain/common";
import type { ResponseMode } from "@/domain/behavior-taxonomy";
import type { OrganicWorldviewMode, WorldviewMode } from "@/domain/behavior-taxonomy";

/** §9.6：能量与策略决定允许的世界观强度上限。 */
export function getEnergyAllowedModes(input: {
  energy: EnergyLevel;
  responseMode: ResponseMode;
}): OrganicWorldviewMode[] {
  if (input.responseMode === "ONE_STEP_HELP") {
    if (input.energy === "E0") return [];
    return ["W1"];
  }
  if (input.energy === "E0") return ["W1"];
  return ["W1", "W2"];
}

export function intersectWorldviewModes(
  allowed: OrganicWorldviewMode[],
  seedModes: OrganicWorldviewMode[],
): OrganicWorldviewMode[] {
  const set = new Set(seedModes);
  return allowed.filter((mode) => set.has(mode));
}

const COMPANION_LIKE_MODES: readonly ResponseMode[] = [
  "COMPANION",
  "ASK_LIGHT",
  "CELEBRATE",
];

/**
 * 有机世界观强度选择。
 * - 不改变调度频率（仍由 credit-v1 控制 ~25%）
 * - E2/E3 陪伴轮在种子允许时取 W2，让显性陪衬更易被读者感知
 * - E0/E1 保持 W1，避免短回复被世界观挤占
 */
export function pickOrganicWorldviewMode(
  modes: OrganicWorldviewMode[],
  input: { energy: EnergyLevel; responseMode: ResponseMode },
): WorldviewMode | null {
  if (modes.length === 0) return null;
  const hasW1 = modes.includes("W1");
  const hasW2 = modes.includes("W2");

  if (
    hasW1 &&
    hasW2 &&
    COMPANION_LIKE_MODES.includes(input.responseMode) &&
    (input.energy === "E2" || input.energy === "E3")
  ) {
    return "W2";
  }
  if (hasW1) return "W1";
  return "W2";
}

/** @deprecated 使用 pickOrganicWorldviewMode */
export function pickLowerWorldviewMode(
  modes: OrganicWorldviewMode[],
): WorldviewMode | null {
  return pickOrganicWorldviewMode(modes, {
    energy: "E1",
    responseMode: "COMPANION",
  });
}
