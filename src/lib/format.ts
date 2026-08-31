export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTokens(
  usage: { inputTokens: number | null; outputTokens: number | null; source: string },
): string {
  if (usage.source === "unavailable") return "token 词元数不可用";
  return `token 词元 输入 ${usage.inputTokens ?? "—"} / 输出 ${usage.outputTokens ?? "—"}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function shortHash(hash: string): string {
  return hash ? hash.slice(0, 10) : "—";
}

export const FINISH_REASON_TEXT: Record<string, string> = {
  completed: "正常结束",
  length: "达到输出上限，内容可能未完成",
  content_filter: "被内容过滤中断",
  cancelled: "已取消",
  unknown: "结束原因未知",
};
