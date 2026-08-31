"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunSummary } from "@/domain/run";
import { useProfiles } from "@/components/app-shell/profile-context";
import { EmptyState, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import {
  formatDateTime,
  formatLatency,
  formatTokens,
  shortHash,
} from "@/lib/format";
import { labelOf, PROVIDER_LABELS } from "@/lib/labels";
import { RunInspector } from "./run-inspector";

export function RunsView() {
  const { activeProfileId } = useProfiles();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const params = new URLSearchParams({
        profileId: activeProfileId,
        limit: "100",
      });
      if (provider) params.set("provider", provider);
      if (status) params.set("status", status);

      const page = await api.get<{ total: number; items: RunSummary[] }>(
        `/api/runs?${params.toString()}`,
      );
      setRuns(page.items);
      setTotal(page.total);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProfileId, provider, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;

  const succeeded = runs.filter((run) => run.status === "succeeded").length;

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="label">供应商</span>
          <select
            className="field mt-1"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            <option value="">全部</option>
            <option value="kimi">Kimi</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI（历史）</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="label">状态</span>
          <select
            className="field mt-1"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部</option>
            <option value="succeeded">succeeded 成功</option>
            <option value="failed">failed 调用失败</option>
          </select>
        </label>
        <span className="text-xs text-[var(--color-muted)]">
          共 {total} 条，本页成功 {succeeded} 条
        </span>
      </div>

      {runs.length === 0 ? (
        <EmptyState>这个档案还没有运行记录。</EmptyState>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className="card block w-full px-3 py-2 text-left"
              onClick={() => setOpenRunId(run.id)}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span
                  className={
                    run.status === "failed" ? "text-[var(--color-danger)]" : ""
                  }
                >
                  {run.status === "failed" ? "调用失败" : "成功"}
                </span>
                <span>{run.slotLabel ?? "—"}</span>
                <span className="text-[var(--color-muted)]">
                  {labelOf(PROVIDER_LABELS, run.provider)} · {run.modelId}
                </span>
                <span className="ml-auto text-xs text-[var(--color-muted)]">
                  {formatDateTime(run.startedAt)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
                <span>{formatLatency(run.latencyMs)}</span>
                <span>{formatTokens(run.usage)}</span>
                <span className="mono">
                  context 上下文指纹 {shortHash(run.contextHash)}
                </span>
                {run.error ? <span>{run.error.code}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {openRunId ? (
        <RunInspector
          profileId={activeProfileId}
          runId={openRunId}
          onClose={() => setOpenRunId(null)}
        />
      ) : null}
    </div>
  );
}
