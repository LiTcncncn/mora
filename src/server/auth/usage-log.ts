import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "@/server/config/env";

/** 匿名用量日志：不含聊天原文。 */
export async function appendUsageLog(entry: {
  at?: string;
  userId: string;
  role: string;
  event: string;
  provider?: string;
  modelId?: string;
  ok?: boolean;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): Promise<void> {
  try {
    const dir = getDataDir();
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      at: entry.at ?? new Date().toISOString(),
      userId: entry.userId,
      role: entry.role,
      event: entry.event,
      provider: entry.provider ?? null,
      modelId: entry.modelId ?? null,
      ok: entry.ok ?? null,
      latencyMs: entry.latencyMs ?? null,
      promptTokens: entry.promptTokens ?? null,
      completionTokens: entry.completionTokens ?? null,
    });
    await appendFile(path.join(dir, "usage.jsonl"), `${line}\n`, "utf8");
  } catch {
    // 用量日志失败不影响主路径
  }
}
