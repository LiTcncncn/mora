import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendUsageLog } from "@/server/auth/usage-log";
import { getDataDir, getDeviceToken, getMinimaxAsrModel } from "@/server/config/env";
import { deviceRegistry } from "@/server/devices/registry";
import { runVoiceTurn } from "@/server/orchestration/voice-turn";
import { transcribeWav } from "@/server/speech/minimax";
import { startDeviceGateway } from "./server";
import { releasePreviousGateways } from "./singleton";

releasePreviousGateways();

const token = getDeviceToken();
if (!token) {
  console.error("缺少 DEVICE_TOKEN。请把它写进 .env.local 后再启动硬件网关。");
  process.exit(1);
}

const dataDir = getDataDir();
const traceFile = path.join(dataDir, "device-turns.jsonl");
const audioDir = path.join(dataDir, "device-audio");
const saveAudio = process.env.DEVICE_SAVE_AUDIO === "1";
/** 留空：等完整网络 Router（能量判断）。0：跳过网络。正数：超时后规则兜底。 */
function parseRouterBudgetMs(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}
const routerBudgetMs = parseRouterBudgetMs(process.env.DEVICE_ROUTER_BUDGET_MS);

/** 硬件不登录，用量日志里按设备 ID 记。 */
function deviceActor(deviceId: string | null | undefined): { userId: string; role: string } {
  return { userId: `device:${deviceId ?? "unknown"}`, role: "device" };
}

async function transcribeForDevice(
  wav: Blob,
  signal: AbortSignal,
  deviceId: string | null,
): Promise<string> {
  const started = Date.now();
  const actor = deviceActor(deviceId);
  try {
    const result = await transcribeWav(wav, signal);
    await appendUsageLog({
      ...actor,
      event: "voice_asr",
      provider: "minimax",
      modelId: getMinimaxAsrModel(),
      ok: true,
      latencyMs: Date.now() - started,
    });
    return result.text;
  } catch (error) {
    if (signal.aborted) {
      throw error instanceof Error ? error : new Error("aborted");
    }
    await appendUsageLog({
      ...actor,
      event: "voice_asr",
      provider: "minimax",
      modelId: getMinimaxAsrModel(),
      ok: false,
      latencyMs: Date.now() - started,
    });
    throw error;
  }
}

const gateway = startDeviceGateway({
  token,
  port: Number(process.env.DEVICE_GATEWAY_PORT ?? 8787),
  registry: deviceRegistry,
  advertiseHost: process.env.DEVICE_GATEWAY_MDNS !== "0",
  runTurn: (wav, binding, signal, emit, transcript) =>
    runVoiceTurn(
      {
        profileId: binding.profileId,
        conversationId: binding.conversationId,
        modelSlotId: binding.modelSlotId,
        voiceId: binding.voiceId,
        audio: wav,
        clientPersist: false,
        forceAutoMemoryWrite: false,
        actor: deviceActor(binding.deviceId),
        signal,
        transcript,
        routerBudgetMs,
      },
      emit,
    ),
  transcribe: transcribeForDevice,
  hooks: {
    onTrace: (trace) => {
      const { marks } = trace;
      console.log(
        `[device-turn] ${trace.deviceId ?? "-"} ${trace.outcome} 说话${trace.utteranceMs}ms 识别${marks.asr ?? "-"} 路由${marks.router ?? "-"} 首字${marks.first_token ?? "-"} 首音${marks.first_audio ?? "-"} 放完${marks.playback_done ?? marks.listen ?? "-"}`,
      );
      void appendFile(traceFile, `${JSON.stringify(trace)}\n`, "utf8").catch(() => undefined);
    },
    onUtterance: saveAudio
      ? (turnId, wav) => {
          void (async () => {
            await mkdir(audioDir, { recursive: true });
            await writeFile(path.join(audioDir, `${turnId}.wav`), Buffer.from(await wav.arrayBuffer()));
          })().catch(() => undefined);
        }
      : undefined,
  },
});

const shutdown = (): void => {
  void gateway.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
