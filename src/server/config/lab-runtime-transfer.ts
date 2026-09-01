import "server-only";
import type { LabRuntimeExport } from "@/domain/behavior-config";
import type { SettingsData } from "@/domain/settings";
import {
  personaRepository,
  promptPresetRepository,
} from "../persistence/repositories";
import {
  exportConfigBundle,
  importConfigBundle,
} from "./bundle";

/** 完整导出时从各仓库组装 Lab 运行时块。 */
export async function fetchLabRuntimeExport(
  profileId: string,
): Promise<LabRuntimeExport> {
  const bundle = await exportConfigBundle(profileId);
  return {
    settings: bundle.settings,
    personas: bundle.personas,
    promptPresets: bundle.promptPresets,
  };
}

/**
 * 导入完整包时把 Persona / Preset / Settings 写回各仓库。
 * 复用 v1 bundle 导入逻辑，保证 active 引用重写一致。
 */
export async function applyLabRuntimeImport(
  profileId: string,
  profileName: string,
  runtime: LabRuntimeExport,
): Promise<SettingsData> {
  return importConfigBundle(profileId, {
    schemaVersion: 1,
    kind: "mora_behavior_config",
    exportedAt: new Date().toISOString(),
    sourceProfileName: profileName,
    settings: runtime.settings,
    personas: runtime.personas,
    promptPresets: runtime.promptPresets,
  });
}

/** 导入预览：统计 labRuntime 相对当前的变更量。 */
export async function summarizeLabRuntimeDelta(
  profileId: string,
  runtime: LabRuntimeExport,
): Promise<{
  personaCount: number;
  promptPresetCount: number;
  replacesPersonaCount: number;
  replacesPromptPresetCount: number;
}> {
  const [personas, presets] = await Promise.all([
    personaRepository.list(profileId),
    promptPresetRepository.list(profileId),
  ]);
  return {
    personaCount: runtime.personas.length,
    promptPresetCount: runtime.promptPresets.length,
    replacesPersonaCount: personas.length,
    replacesPromptPresetCount: presets.length,
  };
}
