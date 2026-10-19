import "server-only";
import {
  LEGACY_DEVICE_ID,
  devicesDataSchema,
  type DeviceConfig,
  type DeviceRecord,
  type DevicesData,
} from "@/domain/device";
import type { VoiceId } from "@/domain/voice";
import { AppError } from "../api/errors";
import { behaviorConfigStore } from "../config/behavior-repository";
import { JsonStore } from "../persistence/atomic-json-store";
import {
  conversationRepository,
  personaRepository,
  personasStore,
  profileRepository,
  promptPresetRepository,
  promptPresetsStore,
  settingsRepository,
} from "../persistence/repositories";

/**
 * 硬件设备登记表。只有网关进程写这个文件；Lab 读它来生成日志、展示列表。
 *
 * 每台设备一个独立档案：配置（Persona、Prompt、Settings、行为配置）从模板档案复制，
 * 对话、记忆、运行记录各自隔离。
 */
export const devicesStore = new JsonStore("devices", devicesDataSchema);

export function getTemplateProfileId(): string {
  return process.env.DEVICE_TEMPLATE_PROFILE_ID?.trim() || "profile-default";
}

export interface DeviceBindingTarget {
  profileId: string;
  conversationId: string;
  modelSlotId: string;
  voiceId: VoiceId;
}

export interface DeviceHello {
  deviceId: string;
  firmwareVersion: string | null;
  rssi: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

let queue: Promise<unknown> = Promise.resolve();

/** 同一台设备断线重连可能并发触发登记，这里一律排队。 */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function resolveTemplate(config: DeviceConfig) {
  const templateId = getTemplateProfileId();
  const settings = await settingsRepository.get(templateId);
  const personas = await personaRepository.list(templateId);
  const persona =
    personas.find((item) => item.id === config.personaId) ??
    personas.find((item) => item.id === settings.activePersonaId) ??
    personas[0];
  if (!persona) throw new AppError("NOT_FOUND", "模板档案里没有 Persona");

  const enabled = settings.compare.modelSlots.filter((slot) => slot.enabled);
  const slot =
    enabled.find((item) => item.id === config.modelSlotId) ??
    enabled.find((item) => item.provider === "deepseek") ??
    enabled[0];
  if (!slot) throw new AppError("NOT_FOUND", "模板档案里没有启用的模型槽位");

  return { templateId, settings, persona, slot };
}

/** 把模板档案的配置复制到设备档案；对话和记忆不动。 */
async function syncProfile(record: DeviceRecord, config: DeviceConfig): Promise<string> {
  const { templateId, settings, persona, slot } = await resolveTemplate(config);
  const profileId = record.profileId;
  const personaId = `persona-${profileId}`;
  const presetId = `preset-${profileId}`;
  const preset = await promptPresetRepository.get(templateId, settings.activePromptPresetId);
  const timestamp = nowIso();

  await personasStore.update((current) => {
    const copy = { ...structuredClone(persona), id: personaId, profileId, updatedAt: timestamp };
    const items = current.items.filter((item) => !(item.id === personaId && item.profileId === profileId));
    return { next: { items: [...items, copy] }, result: null };
  });
  await promptPresetsStore.update((current) => {
    const copy = { ...structuredClone(preset), id: presetId, profileId, updatedAt: timestamp };
    const items = current.items.filter((item) => !(item.id === presetId && item.profileId === profileId));
    return { next: { items: [...items, copy] }, result: null };
  });
  await settingsRepository.save(profileId, {
    ...structuredClone(settings),
    activePersonaId: personaId,
    activePromptPresetId: presetId,
  });
  await behaviorConfigStore.update((current) => {
    const template = current.items.find((item) => item.profileId === templateId);
    const items = current.items.filter((item) => item.profileId !== profileId);
    if (template) items.push({ profileId, config: structuredClone(template.config) });
    return { next: { items }, result: null };
  });
  return slot.id;
}

function bindingOf(record: DeviceRecord, config: DeviceConfig, modelSlotId: string): DeviceBindingTarget {
  return {
    profileId: record.profileId,
    conversationId: record.conversationId,
    modelSlotId,
    voiceId: config.voiceId,
  };
}

async function writeRecord(next: DeviceRecord): Promise<DeviceRecord> {
  return devicesStore.update((current) => {
    const items = current.items.filter((item) => item.deviceId !== next.deviceId);
    return { next: { ...current, items: [...items, next] }, result: next };
  });
}

async function requireRecord(deviceId: string): Promise<{ data: DevicesData; record: DeviceRecord }> {
  const data = await devicesStore.read();
  const record = data.items.find((item) => item.deviceId === deviceId);
  if (!record) throw new AppError("NOT_FOUND", "找不到这台设备");
  return { data, record };
}

export const deviceRegistry = {
  read(): Promise<DevicesData> {
    return devicesStore.read();
  },

  /** 设备连上时调用：首次连接自动登记并建档，之后只刷新在线信息。 */
  register(hello: DeviceHello): Promise<{ record: DeviceRecord; binding: DeviceBindingTarget }> {
    return serial(async () => {
      const data = await devicesStore.read();
      const existing = data.items.find((item) => item.deviceId === hello.deviceId);
      const seen = {
        firmwareVersion: hello.firmwareVersion,
        lastRssi: hello.rssi,
        lastSeenAt: nowIso(),
      };
      if (existing) {
        const record = await writeRecord({ ...existing, ...seen });
        const { slot } = await resolveTemplate(data.config);
        return { record, binding: bindingOf(record, data.config, slot.id) };
      }

      const displayName =
        hello.deviceId === LEGACY_DEVICE_ID ? "旧固件设备" : `ZHAKA ${data.items.length + 1}`;
      const profile = await profileRepository.create(`硬件 · ${displayName}（${hello.deviceId}）`);
      const conversation = await conversationRepository.create(profile.id, `${displayName} 硬件对话`);
      const draft: DeviceRecord = {
        deviceId: hello.deviceId,
        displayName,
        profileId: profile.id,
        conversationId: conversation.id,
        archivedConversationIds: [],
        volume: data.config.volume,
        enabled: true,
        createdAt: nowIso(),
        ...seen,
      };
      const modelSlotId = await syncProfile(draft, data.config);
      const record = await writeRecord(draft);
      return { record, binding: bindingOf(record, data.config, modelSlotId) };
    });
  },

  /** admin 改了硬件配置或模板档案后，把所有设备档案重新对齐。 */
  applyConfig(
    config: DeviceConfig,
    options: { applyVolume: boolean },
  ): Promise<{ data: DevicesData; bindings: Map<string, DeviceBindingTarget> }> {
    return serial(async () => {
      await resolveTemplate(config);
      const data = await devicesStore.update((current) => {
        const next: DevicesData = {
          config,
          items: options.applyVolume
            ? current.items.map((item) => ({ ...item, volume: config.volume }))
            : current.items,
        };
        return { next, result: next };
      });
      const bindings = new Map<string, DeviceBindingTarget>();
      for (const record of data.items) {
        const modelSlotId = await syncProfile(record, config);
        bindings.set(record.deviceId, bindingOf(record, config, modelSlotId));
      }
      return { data, bindings };
    });
  },

  update(
    deviceId: string,
    patch: Partial<Pick<DeviceRecord, "displayName" | "volume" | "enabled">>,
  ): Promise<DeviceRecord> {
    return serial(async () => {
      const { record } = await requireRecord(deviceId);
      return writeRecord({ ...record, ...patch });
    });
  },

  /** 旧对话留在档案里，日志文档仍会包含；新对话从空白开始。 */
  archiveConversation(deviceId: string): Promise<{ record: DeviceRecord; binding: DeviceBindingTarget }> {
    return serial(async () => {
      const { data, record } = await requireRecord(deviceId);
      const conversation = await conversationRepository.create(
        record.profileId,
        `${record.displayName} 硬件对话 ${new Date().toLocaleDateString("zh-CN")}`,
      );
      const next = await writeRecord({
        ...record,
        conversationId: conversation.id,
        archivedConversationIds: [...record.archivedConversationIds, record.conversationId],
      });
      const { slot } = await resolveTemplate(data.config);
      return { record: next, binding: bindingOf(next, data.config, slot.id) };
    });
  },
};
