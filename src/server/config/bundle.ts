import "server-only";
import { randomUUID } from "node:crypto";
import type {
  ConfigImportSummary,
  MoraConfigBundle,
} from "@/domain/config-bundle";
import type { FewShotSample } from "@/domain/fewshot";
import type { Persona } from "@/domain/persona";
import type { PromptPreset } from "@/domain/prompt";
import type { SettingsData } from "@/domain/settings";
import {
  fewShotRepository,
  fewShotStore,
  personaRepository,
  personasStore,
  profileRepository,
  promptPresetRepository,
  promptPresetsStore,
  settingsRepository,
} from "../persistence/repositories";

export async function exportConfigBundle(
  profileId: string,
): Promise<MoraConfigBundle> {
  const [profile, settings, personas, promptPresets, fewShotSamples] =
    await Promise.all([
      profileRepository.requireProfile(profileId),
      settingsRepository.get(profileId),
      personaRepository.list(profileId),
      promptPresetRepository.list(profileId),
      fewShotRepository.list(profileId),
    ]);

  return {
    schemaVersion: 1,
    kind: "mora_behavior_config",
    exportedAt: new Date().toISOString(),
    sourceProfileName: profile.name,
    settings,
    personas,
    promptPresets,
    fewShotSamples,
  };
}

export function summarizeBundle(
  bundle: MoraConfigBundle,
  current: {
    personaCount: number;
    promptPresetCount: number;
    fewShotSampleCount: number;
  },
): ConfigImportSummary {
  return {
    personaCount: bundle.personas.length,
    promptPresetCount: bundle.promptPresets.length,
    fewShotSampleCount: bundle.fewShotSamples?.length ?? null,
    modelSlots: bundle.settings.compare.modelSlots.map((slot) => ({
      label: slot.label,
      provider: slot.provider,
      modelId: slot.modelId,
    })),
    sourceProfileName: bundle.sourceProfileName,
    exportedAt: bundle.exportedAt,
    replacesPersonaCount: current.personaCount,
    replacesPromptPresetCount: current.promptPresetCount,
    replacesFewShotSampleCount: current.fewShotSampleCount,
  };
}

/**
 * 导入时为 Persona / Preset 重新生成当前档案内 ID，并重写 active 引用。
 * 安全底线不受配置影响：其内容始终由服务端常量提供。
 */
export async function importConfigBundle(
  profileId: string,
  bundle: MoraConfigBundle,
): Promise<SettingsData> {
  await profileRepository.requireProfile(profileId);

  const personaIdMap = new Map<string, string>();
  const presetIdMap = new Map<string, string>();
  const timestamp = new Date().toISOString();

  const personas: Persona[] = bundle.personas.map((persona) => {
    const id = `persona-${randomUUID()}`;
    personaIdMap.set(persona.id, id);
    return { ...persona, id, profileId, createdAt: timestamp, updatedAt: timestamp };
  });

  const promptPresets: PromptPreset[] = bundle.promptPresets.map((preset) => {
    const id = `preset-${randomUUID()}`;
    presetIdMap.set(preset.id, id);
    return { ...preset, id, profileId, createdAt: timestamp, updatedAt: timestamp };
  });

  const fewShotSamples: FewShotSample[] | null =
    bundle.fewShotSamples?.map((sample) => ({
      ...sample,
      id: `fs-${randomUUID()}`,
      profileId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })) ?? null;

  const activePersonaId =
    personaIdMap.get(bundle.settings.activePersonaId) ?? personas[0]?.id;
  const activePromptPresetId =
    presetIdMap.get(bundle.settings.activePromptPresetId) ??
    promptPresets[0]?.id;

  if (!activePersonaId || !activePromptPresetId) {
    throw new Error("配置文件缺少可用的 Persona 或 Prompt Preset");
  }

  await personasStore.update((current) => ({
    next: {
      items: [
        ...current.items.filter((item) => item.profileId !== profileId),
        ...personas,
      ],
    },
    result: null,
  }));

  await promptPresetsStore.update((current) => ({
    next: {
      items: [
        ...current.items.filter((item) => item.profileId !== profileId),
        ...promptPresets,
      ],
    },
    result: null,
  }));

  // 配置文件不含样本字段时不动现有样本，避免导入旧配置把语料清空。
  if (fewShotSamples) {
    await fewShotStore.update((current) => ({
      next: {
        items: [
          ...current.items.filter((item) => item.profileId !== profileId),
          ...fewShotSamples,
        ],
      },
      result: null,
    }));
  }

  return settingsRepository.save(profileId, {
    ...bundle.settings,
    activePersonaId,
    activePromptPresetId,
  });
}
