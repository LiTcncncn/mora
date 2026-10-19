import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_VOICE_ID } from "@/domain/device";
import { getDataDir } from "../config/env";
import { conversationRepository, personaRepository, settingsRepository } from "../persistence/repositories";
import { deviceRegistry } from "./registry";

beforeEach(async () => {
  await fs.rm(getDataDir(), { recursive: true, force: true });
});

describe("deviceRegistry", () => {
  it("首次连接自动建档，再次连接只刷新在线信息", async () => {
    const first = await deviceRegistry.register({
      deviceId: "zhaka-aabbccddeeff",
      firmwareVersion: "0.3.0",
      rssi: -61,
    });
    expect(first.record.displayName).toMatch(/^ZHAKA /);
    expect(first.record.volume).toBe(69);
    expect(first.binding.voiceId).toBe(DEFAULT_DEVICE_VOICE_ID);
    expect(first.binding.profileId).toBe(first.record.profileId);
    expect(first.binding.profileId).not.toBe("profile-default");

    const settings = await settingsRepository.get(first.record.profileId);
    const personas = await personaRepository.list(first.record.profileId);
    expect(personas.some((persona) => persona.id === settings.activePersonaId)).toBe(true);
    expect(settings.compare.modelSlots.some((slot) => slot.id === first.binding.modelSlotId)).toBe(
      true,
    );

    const conversation = await conversationRepository.get(
      first.record.profileId,
      first.record.conversationId,
    );
    expect(conversation.messages).toEqual([]);

    const second = await deviceRegistry.register({
      deviceId: "zhaka-aabbccddeeff",
      firmwareVersion: "0.3.1",
      rssi: -55,
    });
    expect(second.record.profileId).toBe(first.record.profileId);
    expect(second.record.conversationId).toBe(first.record.conversationId);
    expect(second.record.firmwareVersion).toBe("0.3.1");
    expect((await deviceRegistry.read()).items).toHaveLength(1);
  });

  it("两台设备各自一份档案和对话", async () => {
    const a = await deviceRegistry.register({
      deviceId: "zhaka-000000000001",
      firmwareVersion: "0.3.0",
      rssi: -40,
    });
    const b = await deviceRegistry.register({
      deviceId: "zhaka-000000000002",
      firmwareVersion: "0.3.0",
      rssi: -50,
    });
    expect(a.record.profileId).not.toBe(b.record.profileId);
    expect(a.record.conversationId).not.toBe(b.record.conversationId);
  });

  it("归档对话会新建空白会话并保留旧 ID", async () => {
    const first = await deviceRegistry.register({
      deviceId: "zhaka-000000000003",
      firmwareVersion: "0.3.0",
      rssi: null,
    });
    const archived = await deviceRegistry.archiveConversation("zhaka-000000000003");
    expect(archived.record.conversationId).not.toBe(first.record.conversationId);
    expect(archived.record.archivedConversationIds).toEqual([first.record.conversationId]);
    expect(archived.record.profileId).toBe(first.record.profileId);
  });
});
