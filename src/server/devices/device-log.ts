import "server-only";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeviceLogFile, DeviceRecord } from "@/domain/device";
import type { RunRecord } from "@/domain/run";
import { AppError } from "../api/errors";
import { getDataDir } from "../config/env";
import {
  conversationRepository,
  memoryRepository,
  runRepository,
} from "../persistence/repositories";
import { devicesStore } from "./registry";

interface TraceLine {
  turnId: string;
  deviceId?: string | null;
  at: string;
  outcome: string;
  utteranceMs: number;
  marks: Record<string, number>;
  transcript: string | null;
  errors: string[];
}

const FILE_PATTERN = /^\d{8}-\d{6}\.md$/;

function logDir(deviceId: string): string {
  return path.join(getDataDir(), "device-logs", deviceId);
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function fileStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function cell(value: string | number | undefined | null): string {
  if (value == null || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

async function readTraces(deviceId: string): Promise<TraceLine[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(getDataDir(), "device-turns.jsonl"), "utf8");
  } catch {
    return [];
  }
  const traces: TraceLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const trace = JSON.parse(line) as TraceLine;
      if (trace.deviceId === deviceId) traces.push(trace);
    } catch {
      // 半行或损坏的行跳过
    }
  }
  return traces;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function requireDevice(deviceId: string): Promise<DeviceRecord> {
  const data = await devicesStore.read();
  const record = data.items.find((item) => item.deviceId === deviceId);
  if (!record) throw new AppError("NOT_FOUND", "找不到这台设备");
  return record;
}

export async function buildDeviceLogMarkdown(deviceId: string, now = new Date()): Promise<string> {
  const record = await requireDevice(deviceId);
  const conversationIds = [...record.archivedConversationIds, record.conversationId];
  const conversations = (await conversationRepository.list(record.profileId))
    .filter((item) => conversationIds.includes(item.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const runs = new Map<string, RunRecord>(
    (await runRepository.list(record.profileId)).map((run) => [run.id, run]),
  );
  const memories = (await memoryRepository.list(record.profileId)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const traces = await readTraces(deviceId);

  const userTurns = conversations.reduce(
    (sum, item) => sum + item.messages.filter((message) => message.role === "user").length,
    0,
  );
  const energyCounts = new Map<string, number>();
  for (const run of runs.values()) {
    if (!conversationIds.includes(run.conversationId)) continue;
    const level = run.contextSnapshot.energy.level;
    energyCounts.set(level, (energyCounts.get(level) ?? 0) + 1);
  }
  const outcomes = new Map<string, number>();
  for (const trace of traces) outcomes.set(trace.outcome, (outcomes.get(trace.outcome) ?? 0) + 1);
  const replied = traces.filter((trace) => trace.outcome === "replied");
  const firstAudio = median(replied.map((trace) => trace.marks.first_audio).filter((v): v is number => v != null));
  const asr = median(replied.map((trace) => trace.marks.asr).filter((v): v is number => v != null));
  const router = median(replied.map((trace) => trace.marks.router).filter((v): v is number => v != null));

  const lines: string[] = [];
  lines.push(`# ZHAKA 设备日志 · ${record.displayName}`, "");
  lines.push(
    `- 设备 ID：\`${record.deviceId}\``,
    `- 设备档案：\`${record.profileId}\``,
    `- 固件版本：${record.firmwareVersion ?? "旧版"}`,
    `- 首次登记：${formatTime(record.createdAt)}`,
    `- 最后在线：${formatTime(record.lastSeenAt)}（RSSI ${record.lastRssi ?? "-"}）`,
    `- 生成时间：${formatTime(now.toISOString())}`,
    "",
  );

  lines.push("## 概要", "");
  lines.push(
    `- 对话：${conversations.length} 段，用户发言 ${userTurns} 次`,
    `- 能量分布：${["E0", "E1", "E2", "E3"].map((level) => `${level} ${energyCounts.get(level) ?? 0}`).join("，")}`,
    `- 硬件回合：${[...outcomes.entries()].map(([key, count]) => `${key} ${count}`).join("，") || "无记录"}`,
    `- 中位时延（成功回合，从说完算起）：识别 ${asr ?? "-"}ms，路由 ${router ?? "-"}ms，首音 ${firstAudio ?? "-"}ms`,
    "",
  );

  lines.push("## 对话记录", "");
  if (conversations.length === 0) lines.push("（暂无对话）", "");
  for (const conversation of conversations) {
    const current = conversation.id === record.conversationId;
    lines.push(
      `### ${conversation.title}${current ? "（当前）" : "（已归档）"}`,
      "",
      `创建于 ${formatTime(conversation.createdAt)}，共 ${conversation.messages.length} 条`,
      "",
    );
    for (const message of conversation.messages) {
      const time = formatTime(message.createdAt);
      if (message.role === "user") {
        lines.push(`**[${time}] 用户**：${message.content}`, "");
        continue;
      }
      const run = message.runId ? runs.get(message.runId) : undefined;
      const meta = run
        ? [
            run.contextSnapshot.energy.level,
            run.contextSnapshot.turnRoutingSource ?? run.contextSnapshot.energy.source,
            run.modelId,
            run.timeToFirstTokenMs != null ? `首字 ${run.timeToFirstTokenMs}ms` : null,
            run.status !== "succeeded" ? run.status : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
      lines.push(`**[${time}] ZHAKA**${meta ? `（${meta}）` : ""}：${message.content}`, "");
    }
  }

  lines.push("## 硬件回合时延", "");
  if (traces.length === 0) {
    lines.push("（暂无记录）", "");
  } else {
    lines.push(
      "| 时间 | 结果 | 说话 ms | 识别 | 路由 | 首字 | 首音 | 放完 | 识别文本 | 错误 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const trace of traces) {
      const { marks } = trace;
      lines.push(
        `| ${cell(formatTime(trace.at))} | ${cell(trace.outcome)} | ${cell(trace.utteranceMs)} | ${cell(marks.asr)} | ${cell(marks.router)} | ${cell(marks.first_token)} | ${cell(marks.first_audio)} | ${cell(marks.playback_done ?? marks.listen)} | ${cell(trace.transcript)} | ${cell(trace.errors.join("；"))} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 记忆", "");
  if (memories.length === 0) lines.push("（暂无记忆）");
  for (const memory of memories) {
    lines.push(
      `- [${memory.type} · ${memory.status}${memory.enabled ? "" : " · 已停用"}] ${memory.content}（${formatTime(memory.createdAt)}）`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function generateDeviceLog(deviceId: string): Promise<DeviceLogFile & { markdown: string }> {
  const now = new Date();
  const markdown = await buildDeviceLogMarkdown(deviceId, now);
  const dir = logDir(deviceId);
  await mkdir(dir, { recursive: true });
  const fileName = `${fileStamp(now)}.md`;
  await writeFile(path.join(dir, fileName), markdown, "utf8");
  return {
    fileName,
    createdAt: now.toISOString(),
    sizeBytes: Buffer.byteLength(markdown),
    markdown,
  };
}

export async function listDeviceLogs(deviceId: string): Promise<DeviceLogFile[]> {
  await requireDevice(deviceId);
  let names: string[];
  try {
    names = await readdir(logDir(deviceId));
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => FILE_PATTERN.test(name))
      .map(async (fileName) => {
        const info = await stat(path.join(logDir(deviceId), fileName));
        return { fileName, createdAt: info.mtime.toISOString(), sizeBytes: info.size };
      }),
  );
  return files.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

export async function readDeviceLog(deviceId: string, fileName: string): Promise<string> {
  await requireDevice(deviceId);
  if (!FILE_PATTERN.test(fileName)) throw new AppError("VALIDATION_ERROR", "日志文件名不合法");
  try {
    return await readFile(path.join(logDir(deviceId), fileName), "utf8");
  } catch {
    throw new AppError("NOT_FOUND", "找不到这份日志");
  }
}
