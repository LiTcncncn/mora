"use client";

import type { BehaviorTrace } from "@/domain/behavior-trace";
import type { EnergyResolution } from "@/domain/energy";
import type { ContextSnapshot } from "@/domain/run";
import { Collapsible, Notice } from "@/components/ui/primitives";
import {
  ENERGY_LEVEL_LABELS,
  ENERGY_SOURCE_LABELS,
  RESPONSE_MODE_LABELS,
  ROUTING_SOURCE_LABELS,
  WORLDVIEW_MODE_LABELS,
  labelOf,
} from "@/lib/labels";

export interface PreviewResult {
  slot: { id: string; label: string };
  energy: EnergyResolution;
  snapshot: ContextSnapshot;
  behaviorTrace?: BehaviorTrace | null;
}

/**
 * 预览结果的展示部分，Compare 的抽屉与 Studio 的内联面板共用，
 * 避免两处各写一份、日后指标口径对不上。
 */
export function ContextPreviewBody({
  result,
  maxTotalChars,
}: {
  result: PreviewResult;
  maxTotalChars?: number;
}) {
  const trace = result.behaviorTrace;
  const overBudget =
    maxTotalChars !== undefined && result.snapshot.charCount > maxTotalChars;

  return (
    <>
      <Notice>
        这是发送前的预览。真正的事实来源是发送后写入 run
        运行记录的快照；如果预览后修改了设置，两者可能不同。
      </Notice>

      <dl className="card grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-xs">
        <div>
          <dt className="text-[var(--color-muted)]">Energy 能量档位</dt>
          <dd>
            {labelOf(ENERGY_LEVEL_LABELS, result.energy.level)}（
            {labelOf(ENERGY_SOURCE_LABELS, result.energy.source)}）
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">字符总数</dt>
          <dd className={overBudget ? "text-[var(--color-danger)]" : undefined}>
            {result.snapshot.charCount}
            {maxTotalChars !== undefined ? ` / ${maxTotalChars}` : ""}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--color-muted)]">共享 hash 上下文指纹</dt>
          <dd className="mono break-all">{result.snapshot.sharedHash}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--color-muted)]">本槽位 hash 上下文指纹</dt>
          <dd className="mono break-all">{result.snapshot.hash}</dd>
        </div>
      </dl>

      <p className="text-xs text-[var(--color-muted)]">
        判定依据：{result.energy.reason}
      </p>

      {trace ? (
        <Collapsible title="Turn Routing 轻量路由预览" defaultOpen>
          <ul className="space-y-1 text-xs">
            <li>
              来源：{labelOf(ROUTING_SOURCE_LABELS, trace.routing.source)} · 策略{" "}
              {labelOf(RESPONSE_MODE_LABELS, trace.turnPlan.responseMode)}
            </li>
            <li>
              世界观：{labelOf(WORLDVIEW_MODE_LABELS, trace.worldview.finalMode)}
              {trace.worldview.seedId
                ? ` · 种子 ${trace.worldview.selectedSeedTitle ?? trace.worldview.seedId}`
                : ""}
            </li>
            <li>
              示例卡：
              {trace.exampleRetrieval.selectedExampleName ??
                trace.exampleRetrieval.selectedExampleId ??
                "无"}
            </li>
          </ul>
        </Collapsible>
      ) : null}

      {result.snapshot.sections.map((section, index) => (
        <Collapsible
          key={`${section.id}-${index}`}
          title={`${index + 1}. ${section.title}（${section.charCount} 字符）`}
        >
          <pre className="overflow-x-auto text-xs whitespace-pre-wrap">
            {section.content}
          </pre>
        </Collapsible>
      ))}
    </>
  );
}
