import { z } from "zod";
import { deviceConfigSchema, type DeviceConfig, type DeviceStatusView } from "@/domain/device";
import { VOICE_OPTIONS } from "@/domain/voice";
import { apiSuccess, handleRoute, parseWith, readJsonBody } from "@/server/api/response";
import { requireAdmin } from "@/server/auth/require-auth";
import { callGateway } from "@/server/devices/gateway-client";
import { devicesStore, getTemplateProfileId } from "@/server/devices/registry";
import { personaRepository, settingsRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configBodySchema = z.object({
  config: deviceConfigSchema,
  applyVolume: z.boolean().default(false),
});

async function templateOptions() {
  const templateProfileId = getTemplateProfileId();
  const [settings, personas] = await Promise.all([
    settingsRepository.get(templateProfileId),
    personaRepository.list(templateProfileId),
  ]);
  return {
    templateProfileId,
    activePersonaId: settings.activePersonaId,
    personas: personas.map((persona) => ({ id: persona.id, name: persona.name })),
    modelSlots: settings.compare.modelSlots
      .filter((slot) => slot.enabled)
      .map((slot) => ({ id: slot.id, label: slot.label, provider: slot.provider, modelId: slot.modelId })),
    voices: VOICE_OPTIONS.map((voice) => ({ id: voice.id, label: voice.label })),
  };
}

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const options = await templateOptions();
    try {
      const status = await callGateway<{ config: DeviceConfig; items: DeviceStatusView[] }>("/status");
      return apiSuccess({ gatewayOnline: true, ...status, options });
    } catch {
      const data = await devicesStore.read();
      const items: DeviceStatusView[] = data.items.map((record) => ({
        ...record,
        online: false,
        mic: { ok: null, bars: Array<number>(16).fill(0) },
      }));
      return apiSuccess({ gatewayOnline: false, config: data.config, items, options });
    }
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const body = parseWith(configBodySchema, await readJsonBody(request));
    const status = await callGateway("/config", { method: "PUT", body });
    return apiSuccess(status);
  });
}
