"use client";

import { useEffect, useState } from "react";
import type { RunRecord } from "@/domain/run";
import { api, errorMessage } from "@/lib/api-client";
import {
  FINISH_REASON_TEXT,
  formatDateTime,
  formatLatency,
  formatTokens,
} from "@/lib/format";
import {
  ENERGY_LEVEL_LABELS,
  ENERGY_SOURCE_LABELS,
  labelOf,
  PARAMETER_STATUS_LABELS,
  PROVIDER_LABELS,
  RUN_STATUS_LABELS,
} from "@/lib/labels";
import { Collapsible, Notice } from "@/components/ui/primitives";

interface RunDetail {
  run: RunRecord;
  comparisonRuns: Array<{
    id: string;
    slotLabel: string | null;
    provider: string;
    modelId: string;
    status: string;
    contextHash: string;
  }>;
}

export function RunInspector({
  profileId,
  runId,
  onClose,
}: {
  profileId: string;
  runId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<RunDetail>(
          `/api/runs/${runId}?profileId=${encodeURIComponent(profileId)}`,
        );
        if (!cancelled) setDetail(data);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, runId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-medium">Run Inspector 运行记录详情</span>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!detail && !error ? (
            <p className="text-sm text-[var(--color-muted)]">加载中…</p>
          ) : null}

          {detail ? <RunDetailBody detail={detail} /> : null}
        </div>
      </div>
    </div>
  );
}

function RunDetailBody({ detail }: { detail: RunDetail }) {
  const { run } = detail;

  return (
    <>
      <dl className="card grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-xs">
        <Item label="Run ID 运行编号" value={run.id} mono />
        <Item label="状态" value={labelOf(RUN_STATUS_LABELS, run.status)} />
        <Item label="槽位" value={run.slotLabel ?? "—"} />
        <Item
          label="供应商 / 模型"
          value={`${labelOf(PROVIDER_LABELS, run.provider)} · ${run.modelId}`}
        />
        <Item label="开始时间" value={formatDateTime(run.startedAt)} />
        <Item label="延迟" value={formatLatency(run.latencyMs)} />
        <Item label="token 词元用量" value={formatTokens(run.usage)} />
        <Item
          label="结束原因"
          value={run.finishReason ? FINISH_REASON_TEXT[run.finishReason] ?? run.finishReason : "—"}
        />
        <Item
          label="共享 Context hash 上下文指纹"
          value={run.sharedContextHash}
          mono
        />
        <Item
          label="本槽位 Context hash 上下文指纹"
          value={run.contextHash}
          mono
        />
      </dl>

      {run.error ? (
        <Notice tone="error">
          错误代码 {run.error.code}：{run.error.message}
        </Notice>
      ) : null}

      <Collapsible
        title={`Energy 能量档位判定：${labelOf(
          ENERGY_LEVEL_LABELS,
          run.contextSnapshot.energy.level,
        )}`}
      >
        <p className="text-sm">
          来源：{labelOf(ENERGY_SOURCE_LABELS, run.contextSnapshot.energy.source)}
        </p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {run.contextSnapshot.energy.reason}
        </p>
      </Collapsible>

      {run.policyDeviation ? (
        <Collapsible title="Energy Policy 低电量策略偏差观察（不影响模型原文）">
          <ul className="space-y-1 text-sm">
            <li>
              字符数 {run.policyDeviation.actualChars} / 目标 ≤{" "}
              {run.policyDeviation.targetMaxChars}
            </li>
            <li>
              句数 {run.policyDeviation.actualSentences} / 目标 ≤{" "}
              {run.policyDeviation.targetMaxSentences}
            </li>
            <li>
              问句 {run.policyDeviation.actualQuestions} / 目标 ≤{" "}
              {run.policyDeviation.maxQuestions}
            </li>
            <li>
              结果：{run.policyDeviation.withinTarget ? "符合目标" : "超出目标"}
            </li>
          </ul>
        </Collapsible>
      ) : null}

      <Collapsible title={`模型参数（${run.appliedParameters.length} 项）`}>
        {run.appliedParameters.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">本次调用没有记录参数。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {run.appliedParameters.map((parameter, index) => (
              <li key={`${parameter.name}-${index}`} className="flex flex-wrap gap-2">
                <span className="mono">{parameter.name}</span>
                <span>{JSON.stringify(parameter.requestedValue)}</span>
                <span
                  className={
                    parameter.status === "not_applied"
                      ? "text-[var(--color-danger)]"
                      : "text-[var(--color-muted)]"
                  }
                >
                  {labelOf(PARAMETER_STATUS_LABELS, parameter.status)}
                  {parameter.reason ? `：${parameter.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible
        title={`Memory 记忆选择（入选 ${run.contextSnapshot.selectedMemoryIds.length} 条）`}
      >
        {run.contextSnapshot.memorySelectionTrace.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            没有候选 Memory 记忆。
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {run.contextSnapshot.memorySelectionTrace.map((trace) => (
              <li key={trace.memoryId}>
                <span className="mono">{trace.memoryId.slice(0, 12)}</span>{" "}
                {trace.selected ? "入选" : "未入选"} · 总分{" "}
                {trace.scores.total.toFixed(3)} · {trace.reason}
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible title="Context 上下文分区">
        <div className="space-y-3">
          {run.contextSnapshot.sections.map((section, index) => (
            <div key={`${section.id}-${index}`}>
              <div className="text-xs text-[var(--color-muted)]">
                {index + 1}. {section.title} · {section.charCount} 字符 · 约{" "}
                {section.estimatedTokens ?? "—"} token 词元（估算）
              </div>
              <pre className="mt-1 overflow-x-auto rounded border bg-[var(--color-canvas)] p-2 text-xs whitespace-pre-wrap">
                {section.content}
              </pre>
            </div>
          ))}
        </div>
      </Collapsible>

      {run.outputText ? (
        <Collapsible title="模型完整原文">
          <pre className="overflow-x-auto text-sm whitespace-pre-wrap">
            {run.outputText}
          </pre>
        </Collapsible>
      ) : null}

      {detail.comparisonRuns.length > 0 ? (
        <Collapsible title={`同轮其他槽位（${detail.comparisonRuns.length}）`}>
          <ul className="space-y-1 text-sm">
            {detail.comparisonRuns.map((sibling) => (
              <li key={sibling.id}>
                {sibling.slotLabel ?? sibling.id} ·{" "}
                {labelOf(PROVIDER_LABELS, sibling.provider)} · {sibling.modelId} ·{" "}
                {labelOf(RUN_STATUS_LABELS, sibling.status)} ·{" "}
                <span className="mono">{sibling.contextHash.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </>
  );
}

function Item({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className={`break-all ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}
