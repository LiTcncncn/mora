import { personasDataSchema, type Persona } from "@/domain/persona";
import { promptPresetsDataSchema, type PromptPreset } from "@/domain/prompt";
import {
  settingsStoreDataSchema,
  type SettingsData,
} from "@/domain/settings";
import { storeEnvelopeSchema } from "@/domain/store";
import personasSeed from "../../../data-seed/personas.json";
import promptPresetsSeed from "../../../data-seed/prompt-presets.json";
import settingsSeed from "../../../data-seed/settings.json";

const SEED_PROFILE_ID = "profile-default";

function readSeedPersona(): Persona {
  const parsed = storeEnvelopeSchema(personasDataSchema).parse(personasSeed);
  const persona = parsed.data.items.find(
    (item) => item.profileId === SEED_PROFILE_ID,
  );
  if (!persona) throw new Error("personas seed 缺少默认 Persona");
  return persona;
}

function readSeedPromptPreset(): PromptPreset {
  const parsed = storeEnvelopeSchema(promptPresetsDataSchema).parse(
    promptPresetsSeed,
  );
  const preset = parsed.data.items.find(
    (item) => item.profileId === SEED_PROFILE_ID,
  );
  if (!preset) throw new Error("prompt-presets seed 缺少默认 Preset");
  return preset;
}

function readSeedSettings(): SettingsData {
  const parsed = storeEnvelopeSchema(settingsStoreDataSchema).parse(settingsSeed);
  const entry = parsed.data.items.find(
    (item) => item.profileId === SEED_PROFILE_ID,
  );
  if (!entry) throw new Error("settings seed 缺少默认设置");
  return entry.settings;
}

export function getSeedPromptSections(): PromptPreset["sections"] {
  return structuredClone(readSeedPromptPreset().sections);
}

export function getSeedPersonaTemplate(): Persona {
  return structuredClone(readSeedPersona());
}

/** 为新档案生成一套独立的 Persona、Preset 与 Settings。 */
export function buildDefaultSettings(
  profileId: string,
  profileName: string,
): { settings: SettingsData; persona: Persona; promptPreset: PromptPreset } {
  const timestamp = new Date().toISOString();
  const personaId = `persona-${profileId}`;
  const presetId = `preset-${profileId}`;

  const persona: Persona = {
    ...structuredClone(readSeedPersona()),
    id: personaId,
    profileId,
    name: `MORA Default（${profileName}）`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const promptPreset: PromptPreset = {
    ...structuredClone(readSeedPromptPreset()),
    id: presetId,
    profileId,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const settings: SettingsData = {
    ...structuredClone(readSeedSettings()),
    activePersonaId: personaId,
    activePromptPresetId: presetId,
  };

  return { settings, persona, promptPreset };
}
