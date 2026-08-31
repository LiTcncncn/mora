"use client";

import { useState } from "react";
import type { EnergyLevel } from "@/domain/common";
import type { EnergyResolution } from "@/domain/energy";
import type { ContextSnapshot } from "@/domain/run";
import type { ModelSlot } from "@/domain/settings";
import { api, errorMessage } from "@/lib/api-client";
import {
  ENERGY_LEVEL_LABELS,
  ENERGY_SOURCE_LABELS,
  labelOf,
} from "@/lib/labels";
import { Collapsible, Notice } from "@/components/ui/primitives";

interface PreviewResult {
  slot: { id: string; label: string };
  energy: EnergyResolution;
  snapshot: ContextSnapshot;
}

export function ContextInspector({
  profileId,
  conversationId,
  userMessage,
  slots,
  energyOverride,
  onClose,
}: {
  profileId: string;
  conversationId: string;
  userMessage: string;
  slots: ModelSlot[];
  energyOverride: EnergyLevel | "auto";
  onClose: () => void;
}) {
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runPreview = async (targetSlotId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<PreviewResult>("/api/context/preview", {
        profileId,
        conversationId,
        userMessage,
        modelSlotId: targetSlotId,
        ...(energyOverride === "auto" ? {} : { energyOverride }),
      });
      setResult(data);
    } catch (caught) {
      setError(errorMessage(caught));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-medium">
            Context Inspector 上下文预览（发送前）
          </span>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
          <label className="text-xs">
            <span className="label">模型槽位</span>
            <select
              className="field mt-1"
              value={slotId}
              onChange={(event) => setSlotId(event.target.value)}
            >
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !slotId || !userMessage.trim()}
            onClick={() => void runPreview(slotId)}
          >
            {loading ? "构建中…" : "生成预览"}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {!userMessage.trim() ? (
            <Notice>先在输入框写一句话，再生成预览。</Notice>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}

          {result ? (
            <>
              <Notice>
                这是发送前的预览。真正的事实来源是发送后写入 run 运行记录的快照；如果预览后修改了设置，两者可能不同。
              </Notice>

              <dl className="card grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-xs">
                <div>
                  <dt className="text-[var(--color-muted)]">
                    Energy 能量档位
                  </dt>
                  <dd>
                    {labelOf(ENERGY_LEVEL_LABELS, result.energy.level)}（
                    {labelOf(ENERGY_SOURCE_LABELS, result.energy.source)}）
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-muted)]">字符总数</dt>
                  <dd>{result.snapshot.charCount}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--color-muted)]">
                    共享 hash 上下文指纹
                  </dt>
                  <dd className="mono break-all">{result.snapshot.sharedHash}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--color-muted)]">
                    本槽位 hash 上下文指纹
                  </dt>
                  <dd className="mono break-all">{result.snapshot.hash}</dd>
                </div>
              </dl>

              <p className="text-xs text-[var(--color-muted)]">
                判定依据：{result.energy.reason}
              </p>

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
          ) : null}
        </div>
      </div>
    </div>
  );
}
