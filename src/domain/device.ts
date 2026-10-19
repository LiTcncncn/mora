import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";
import { voiceIdSchema } from "./voice";

/** 固件按 MAC 生成：`zhaka-` 加 MAC 后 6 字节的十六进制。 */
export const DEVICE_ID_PATTERN = /^zhaka-[0-9a-f]{6,12}$/;
/** 旧固件只会发共享口令，没有自己的 ID，统一记在这一台下面。 */
export const LEGACY_DEVICE_ID = "zhaka-legacy";

export const deviceIdSchema = z
  .string()
  .refine((value) => value === LEGACY_DEVICE_ID || DEVICE_ID_PATTERN.test(value), {
    message: "设备 ID 不合法",
  });

export const DEFAULT_DEVICE_VOLUME = 69;
export const DEFAULT_DEVICE_VOICE_ID = "Chinese (Mandarin)_ExplorativeGirl";

/** admin 统一指定、同步到每台设备档案的硬件配置。 */
export const deviceConfigSchema = z.object({
  /** 模板档案里的 Persona；null 表示跟随模板档案当前的 Persona。 */
  personaId: idSchema.nullable(),
  /** 模板档案里的模型槽位；null 表示第一个启用的 DeepSeek 槽位。 */
  modelSlotId: idSchema.nullable(),
  voiceId: voiceIdSchema,
  volume: z.number().min(0).max(100),
});
export type DeviceConfig = z.infer<typeof deviceConfigSchema>;

export const deviceRecordSchema = z.object({
  deviceId: deviceIdSchema,
  displayName: z.string().min(1).max(40),
  profileId: idSchema,
  conversationId: idSchema,
  archivedConversationIds: z.array(idSchema),
  volume: z.number().min(0).max(100),
  enabled: z.boolean(),
  firmwareVersion: z.string().max(40).nullable(),
  lastRssi: z.number().int().nullable(),
  lastSeenAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

export const devicesDataSchema = z.object({
  config: deviceConfigSchema,
  items: z.array(deviceRecordSchema),
});
export type DevicesData = z.infer<typeof devicesDataSchema>;

/** 网关 /status 返回的单台设备：记录加上在线状态。 */
export interface DeviceStatusView extends DeviceRecord {
  online: boolean;
  mic: { ok: boolean | null; bars: number[] };
}

export interface DeviceLogFile {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}
