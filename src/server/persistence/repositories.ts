import "server-only";
import { randomUUID } from "node:crypto";
import { conversationsDataSchema, type Conversation } from "@/domain/conversation";
import { evalsDataSchema } from "@/domain/evaluation";
import { fewShotDataSchema, type FewShotSample } from "@/domain/fewshot";
import { memoriesDataSchema, type MemoryItem } from "@/domain/memory";
import { personasDataSchema, type Persona } from "@/domain/persona";
import { profilesDataSchema, type TestProfile } from "@/domain/profile";
import { promptPresetsDataSchema, type PromptPreset } from "@/domain/prompt";
import { runsDataSchema, type RunRecord } from "@/domain/run";
import {
  settingsStoreDataSchema,
  type SettingsData,
} from "@/domain/settings";
import { AppError } from "../api/errors";
import { behaviorConfigRepository } from "../config/behavior-repository";
import { JsonStore } from "./atomic-json-store";
import { buildDefaultSettings } from "./defaults";

export const profilesStore = new JsonStore("profiles", profilesDataSchema);
export const settingsStore = new JsonStore("settings", settingsStoreDataSchema);
export const personasStore = new JsonStore("personas", personasDataSchema);
export const memoriesStore = new JsonStore("memories", memoriesDataSchema);
export const conversationsStore = new JsonStore(
  "conversations",
  conversationsDataSchema,
);
export const promptPresetsStore = new JsonStore(
  "prompt-presets",
  promptPresetsDataSchema,
);
export const fewShotStore = new JsonStore("fewshot", fewShotDataSchema);
export const runsStore = new JsonStore("runs", runsDataSchema);
export const evalsStore = new JsonStore("evals", evalsDataSchema);

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notFound(what: string): AppError {
  return new AppError("NOT_FOUND", `找不到${what}`);
}

// ---------------------------------------------------------------- profiles

export const profileRepository = {
  async list(): Promise<{ activeProfileId: string; items: TestProfile[] }> {
    return profilesStore.read();
  },

  async requireProfile(profileId: string): Promise<TestProfile> {
    const data = await profilesStore.read();
    const profile = data.items.find((item) => item.id === profileId);
    if (!profile) throw notFound("测试档案");
    return profile;
  },

  async create(name: string): Promise<TestProfile> {
    const timestamp = nowIso();
    const profile: TestProfile = {
      id: newId("profile"),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await profilesStore.update((current) => ({
      next: { ...current, items: [...current.items, profile] },
      result: null,
    }));
    await settingsRepository.ensureForProfile(profile.id, profile.name);
    return profile;
  },

  async rename(profileId: string, name: string): Promise<TestProfile> {
    return profilesStore.update((current) => {
      const index = current.items.findIndex((item) => item.id === profileId);
      if (index === -1) throw notFound("测试档案");
      const existing = current.items[index]!;
      const updated: TestProfile = { ...existing, name, updatedAt: nowIso() };
      const items = [...current.items];
      items[index] = updated;
      return { next: { ...current, items }, result: updated };
    });
  },

  async setActive(profileId: string): Promise<void> {
    await profilesStore.update((current) => {
      if (!current.items.some((item) => item.id === profileId)) {
        throw notFound("测试档案");
      }
      return { next: { ...current, activeProfileId: profileId }, result: null };
    });
  },

  /** 删除档案时级联删除该档案的全部数据；其他档案不受影响。 */
  async remove(profileId: string): Promise<void> {
    const data = await profilesStore.read();
    if (data.items.length <= 1) {
      throw new AppError("CONFLICT", "至少需要保留一个测试档案");
    }
    if (!data.items.some((item) => item.id === profileId)) {
      throw notFound("测试档案");
    }

    await settingsStore.update((current) => ({
      next: {
        items: current.items.filter((item) => item.profileId !== profileId),
      },
      result: null,
    }));
    await personasStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await promptPresetsStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await memoriesStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await fewShotStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await conversationsStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await runsStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await evalsStore.update((current) => ({
      next: { items: current.items.filter((item) => item.profileId !== profileId) },
      result: null,
    }));
    await behaviorConfigRepository.removeForProfile(profileId);

    await profilesStore.update((current) => {
      const items = current.items.filter((item) => item.id !== profileId);
      const activeProfileId =
        current.activeProfileId === profileId
          ? items[0]!.id
          : current.activeProfileId;
      return { next: { activeProfileId, items }, result: null };
    });
  },
};

// ---------------------------------------------------------------- settings

export const settingsRepository = {
  async get(profileId: string): Promise<SettingsData> {
    await profileRepository.requireProfile(profileId);
    const data = await settingsStore.read();
    const entry = data.items.find((item) => item.profileId === profileId);
    if (!entry) throw notFound("该档案的设置");
    return entry.settings;
  },

  async save(profileId: string, settings: SettingsData): Promise<SettingsData> {
    await profileRepository.requireProfile(profileId);
    return settingsStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.profileId === profileId,
      );
      const items = [...current.items];
      if (index === -1) {
        items.push({ profileId, settings });
      } else {
        items[index] = { profileId, settings };
      }
      return { next: { items }, result: settings };
    });
  },

  /** 新档案首次使用时，创建其独立的 Persona、Preset 与 Settings。 */
  async ensureForProfile(profileId: string, profileName: string): Promise<void> {
    const existing = await settingsStore.read();
    if (existing.items.some((item) => item.profileId === profileId)) return;

    const { settings, persona, promptPreset } = buildDefaultSettings(
      profileId,
      profileName,
    );

    await personasStore.update((current) => ({
      next: { items: [...current.items, persona] },
      result: null,
    }));
    await promptPresetsStore.update((current) => ({
      next: { items: [...current.items, promptPreset] },
      result: null,
    }));
    await settingsStore.update((current) => ({
      next: { items: [...current.items, { profileId, settings }] },
      result: null,
    }));
  },
};

// ---------------------------------------------------------------- personas

export const personaRepository = {
  async list(profileId: string): Promise<Persona[]> {
    const data = await personasStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  async get(profileId: string, id: string): Promise<Persona> {
    const data = await personasStore.read();
    const persona = data.items.find(
      (item) => item.id === id && item.profileId === profileId,
    );
    if (!persona) throw notFound("Persona");
    return persona;
  },

  async create(persona: Persona): Promise<Persona> {
    await personasStore.update((current) => ({
      next: { items: [...current.items, persona] },
      result: null,
    }));
    return persona;
  },

  async update(profileId: string, id: string, next: Persona): Promise<Persona> {
    return personasStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (index === -1) throw notFound("Persona");
      const items = [...current.items];
      items[index] = { ...next, id, profileId, updatedAt: nowIso() };
      return { next: { items }, result: items[index]! };
    });
  },

  async remove(profileId: string, id: string): Promise<void> {
    const settings = await settingsRepository.get(profileId);
    if (settings.activePersonaId === id) {
      throw new AppError("CONFLICT", "请先切换当前使用的 Persona，再删除该项");
    }
    await personasStore.update((current) => {
      const exists = current.items.some(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (!exists) throw notFound("Persona");
      return {
        next: {
          items: current.items.filter(
            (item) => !(item.id === id && item.profileId === profileId),
          ),
        },
        result: null,
      };
    });
  },
};

// ---------------------------------------------------------- prompt presets

export const promptPresetRepository = {
  async list(profileId: string): Promise<PromptPreset[]> {
    const data = await promptPresetsStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  async get(profileId: string, id: string): Promise<PromptPreset> {
    const data = await promptPresetsStore.read();
    const preset = data.items.find(
      (item) => item.id === id && item.profileId === profileId,
    );
    if (!preset) throw notFound("Prompt Preset");
    return preset;
  },

  async create(preset: PromptPreset): Promise<PromptPreset> {
    await promptPresetsStore.update((current) => ({
      next: { items: [...current.items, preset] },
      result: null,
    }));
    return preset;
  },

  async update(
    profileId: string,
    id: string,
    next: PromptPreset,
  ): Promise<PromptPreset> {
    return promptPresetsStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (index === -1) throw notFound("Prompt Preset");
      const existing = current.items[index]!;
      const items = [...current.items];
      items[index] = {
        ...next,
        id,
        profileId,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      return { next: { items }, result: items[index]! };
    });
  },

  async remove(profileId: string, id: string): Promise<void> {
    const settings = await settingsRepository.get(profileId);
    if (settings.activePromptPresetId === id) {
      throw new AppError("CONFLICT", "请先切换当前使用的 Preset，再删除该项");
    }
    await promptPresetsStore.update((current) => {
      const exists = current.items.some(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (!exists) throw notFound("Prompt Preset");
      return {
        next: {
          items: current.items.filter(
            (item) => !(item.id === id && item.profileId === profileId),
          ),
        },
        result: null,
      };
    });
  },
};

// ----------------------------------------------------------------- fewshot

export const fewShotRepository = {
  async list(profileId: string): Promise<FewShotSample[]> {
    const data = await fewShotStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  /**
   * 用给定的一批样本整体替换该档案下的语料。语料只在 Lab 里用整份文本编辑，
   * 没有单条增删改的入口，所以这里也不提供。其他档案的样本原样保留。
   */
  async replaceForProfile(
    profileId: string,
    samples: FewShotSample[],
  ): Promise<FewShotSample[]> {
    return fewShotStore.update((current) => {
      const others = current.items.filter(
        (item) => item.profileId !== profileId,
      );
      const next = samples.map((sample) => ({ ...sample, profileId }));
      return { next: { items: [...others, ...next] }, result: next };
    });
  },
};

// ---------------------------------------------------------------- memories

export const memoryRepository = {
  async list(profileId: string): Promise<MemoryItem[]> {
    const data = await memoriesStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  async get(profileId: string, id: string): Promise<MemoryItem> {
    const data = await memoriesStore.read();
    const memory = data.items.find(
      (item) => item.id === id && item.profileId === profileId,
    );
    if (!memory) throw notFound("Memory");
    return memory;
  },

  async create(memory: MemoryItem): Promise<MemoryItem> {
    await memoriesStore.update((current) => ({
      next: { items: [...current.items, memory] },
      result: null,
    }));
    return memory;
  },

  async createMany(memories: MemoryItem[]): Promise<MemoryItem[]> {
    if (memories.length === 0) return [];
    await memoriesStore.update((current) => ({
      next: { items: [...current.items, ...memories] },
      result: null,
    }));
    return memories;
  },

  async update(
    profileId: string,
    id: string,
    next: MemoryItem,
  ): Promise<MemoryItem> {
    return memoriesStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (index === -1) throw notFound("Memory");
      const existing = current.items[index]!;
      const items = [...current.items];
      items[index] = {
        ...next,
        id,
        profileId,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      return { next: { items }, result: items[index]! };
    });
  },

  async remove(profileId: string, id: string): Promise<void> {
    await memoriesStore.update((current) => {
      const exists = current.items.some(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (!exists) throw notFound("Memory");
      return {
        next: {
          items: current.items.filter(
            (item) => !(item.id === id && item.profileId === profileId),
          ),
        },
        result: null,
      };
    });
  },

  /** 只有成功 run 才调用，用于更新使用统计。 */
  async markUsed(profileId: string, memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    const timestamp = nowIso();
    await memoriesStore.update((current) => ({
      next: {
        items: current.items.map((item) =>
          item.profileId === profileId && memoryIds.includes(item.id)
            ? { ...item, lastUsedAt: timestamp, useCount: item.useCount + 1 }
            : item,
        ),
      },
      result: null,
    }));
  },
};

// ----------------------------------------------------------- conversations

export const conversationRepository = {
  async list(profileId: string): Promise<Conversation[]> {
    const data = await conversationsStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  async get(profileId: string, id: string): Promise<Conversation> {
    const data = await conversationsStore.read();
    const conversation = data.items.find(
      (item) => item.id === id && item.profileId === profileId,
    );
    if (!conversation) throw notFound("对话");
    return conversation;
  },

  async create(profileId: string, title: string): Promise<Conversation> {
    const timestamp = nowIso();
    const conversation: Conversation = {
      id: newId("conv"),
      profileId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    await conversationsStore.update((current) => ({
      next: { items: [...current.items, conversation] },
      result: null,
    }));
    return conversation;
  },

  async rename(
    profileId: string,
    id: string,
    title: string,
  ): Promise<Conversation> {
    return conversationsStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (index === -1) throw notFound("对话");
      const items = [...current.items];
      items[index] = { ...items[index]!, title, updatedAt: nowIso() };
      return { next: { items }, result: items[index]! };
    });
  },

  async mutate(
    profileId: string,
    id: string,
    mutator: (conversation: Conversation) => Conversation,
  ): Promise<Conversation> {
    return conversationsStore.update((current) => {
      const index = current.items.findIndex(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (index === -1) throw notFound("对话");
      const items = [...current.items];
      items[index] = { ...mutator(items[index]!), updatedAt: nowIso() };
      return { next: { items }, result: items[index]! };
    });
  },

  async remove(profileId: string, id: string): Promise<void> {
    await conversationsStore.update((current) => {
      const exists = current.items.some(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (!exists) throw notFound("对话");
      return {
        next: {
          items: current.items.filter(
            (item) => !(item.id === id && item.profileId === profileId),
          ),
        },
        result: null,
      };
    });
  },
};

// -------------------------------------------------------------------- runs

export const runRepository = {
  async list(profileId: string): Promise<RunRecord[]> {
    const data = await runsStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },

  async get(profileId: string, id: string): Promise<RunRecord> {
    const data = await runsStore.read();
    const run = data.items.find(
      (item) => item.id === id && item.profileId === profileId,
    );
    if (!run) throw notFound("运行记录");
    return run;
  },

  /** 写入并按 maxRuns 清理该档案最旧记录。 */
  async appendMany(runs: RunRecord[], maxRuns: number): Promise<void> {
    if (runs.length === 0) return;
    await runsStore.update((current) => {
      const items = [...current.items, ...runs];
      const byProfile = new Map<string, RunRecord[]>();
      for (const run of items) {
        const list = byProfile.get(run.profileId) ?? [];
        list.push(run);
        byProfile.set(run.profileId, list);
      }
      const kept: RunRecord[] = [];
      for (const list of byProfile.values()) {
        const sorted = [...list].sort((a, b) =>
          a.startedAt === b.startedAt
            ? a.id.localeCompare(b.id)
            : a.startedAt.localeCompare(b.startedAt),
        );
        kept.push(...sorted.slice(Math.max(0, sorted.length - maxRuns)));
      }
      kept.sort((a, b) =>
        a.startedAt === b.startedAt
          ? a.id.localeCompare(b.id)
          : a.startedAt.localeCompare(b.startedAt),
      );
      return { next: { items: kept }, result: null };
    });
  },

  async remove(profileId: string, id: string): Promise<void> {
    await runsStore.update((current) => {
      const exists = current.items.some(
        (item) => item.id === id && item.profileId === profileId,
      );
      if (!exists) throw notFound("运行记录");
      return {
        next: {
          items: current.items.filter(
            (item) => !(item.id === id && item.profileId === profileId),
          ),
        },
        result: null,
      };
    });
  },
};

// -------------------------------------------------------------------- eval

/** 首版不写入评估，仅保留读取骨架。 */
export const evaluationRepository = {
  async list(profileId: string) {
    const data = await evalsStore.read();
    return data.items.filter((item) => item.profileId === profileId);
  },
};
