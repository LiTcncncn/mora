"use client";

import { useCallback, useEffect, useState } from "react";
import { MEMORY_TYPES, type MemoryItem, type MemoryType } from "@/domain/memory";
import type { MemorySelectionTrace } from "@/domain/memory";
import { useProfiles } from "@/components/app-shell/profile-context";
import {
  Collapsible,
  ConfirmButton,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
} from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  labelOf,
  MEMORY_SOURCE_LABELS,
  MEMORY_TYPE_LABELS,
} from "@/lib/labels";

export function MemoryView() {
  const { activeProfileId } = useProfiles();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [previewInput, setPreviewInput] = useState("");
  const [preview, setPreview] = useState<MemorySelectionTrace[] | null>(null);
  const [previewWindow, setPreviewWindow] = useState<{
    startOn: string;
    endOn: string;
    label: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      setItems(
        await api.get<MemoryItem[]>(
          `/api/memories?profileId=${encodeURIComponent(activeProfileId)}`,
        ),
      );
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProfileId]);

  useEffect(() => {
    setPreview(null);
    setPreviewWindow(null);
    void load();
  }, [load]);

  const update = async (memory: MemoryItem): Promise<void> => {
    if (!activeProfileId) return;
    try {
      await api.put(`/api/memories/${memory.id}`, {
        profileId: activeProfileId,
        memory,
      });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!activeProfileId) return;
    try {
      await api.delete(
        `/api/memories/${id}?profileId=${encodeURIComponent(activeProfileId)}`,
      );
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const removeAll = async (): Promise<void> => {
    if (!activeProfileId) return;
    try {
      await api.delete(
        `/api/memories?profileId=${encodeURIComponent(activeProfileId)}`,
      );
      setPreview(null);
      setPreviewWindow(null);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const create = async (): Promise<void> => {
    if (!activeProfileId) return;
    try {
      await api.post("/api/memories", {
        profileId: activeProfileId,
        memory: {
          type: "other" as MemoryType,
          content: "新的记忆条目",
          importance: 0.5,
          enabled: true,
          pinned: false,
          tags: [],
          source: { kind: "manual" as const },
          status: "active" as const,
          expiresAt: null,
          occurredOn: null,
          occurredEndOn: null,
          occurredPrecision: "unknown" as const,
          timeSource: "manual" as const,
        },
      });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const runPreview = async (): Promise<void> => {
    if (!activeProfileId || !previewInput.trim()) return;
    try {
      const result = await api.post<{
        trace: MemorySelectionTrace[];
        timeWindow: { startOn: string; endOn: string; label: string } | null;
      }>("/api/memories/preview-selection", {
        profileId: activeProfileId,
        userMessage: previewInput,
      });
      setPreview(result.trace);
      setPreviewWindow(result.timeWindow);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (!activeProfileId) return <p className="text-sm">正在加载配置…</p>;

  const candidates = items.filter((item) => item.status === "candidate");
  const actives = items.filter((item) => item.status !== "candidate");
  const filtered = query
    ? actives.filter((item) => item.content.includes(query))
    : actives;

  return (
    <div className="space-y-4 pb-10">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Collapsible
        title={`待确认候选（${candidates.length}）`}
        defaultOpen={candidates.length > 0}
      >
        <Notice>
          候选由抽取模型从你的原话中生成。当前设置为需确认时，必须点「确认并启用」才会进入上下文；自动写入开启时新记忆会直接出现在下方列表。
        </Notice>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">暂无候选。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {candidates.map((item) => (
              <li key={item.id} className="card space-y-2 p-3">
                <textarea
                  className="field min-h-16"
                  value={item.content}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, content: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span>类型 {labelOf(MEMORY_TYPE_LABELS, item.type)}</span>
                  <span>重要度 {item.importance}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void update({ ...item, status: "active" })}
                  >
                    确认并启用
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void remove(item.id)}
                  >
                    拒绝
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible title="选择预览（只读，不更新使用次数）">
        <div className="space-y-2">
          <textarea
            className="field min-h-16"
            placeholder="输入一句话，查看哪些 Memory 记忆会被选中"
            value={previewInput}
            onChange={(event) => setPreviewInput(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={!previewInput.trim()}
            onClick={() => void runPreview()}
          >
            预览选择
          </button>

          {preview ? (
            <>
              {previewWindow ? (
                <Notice>
                  已识别时间窗「{previewWindow.label}」：{previewWindow.startOn}～
                  {previewWindow.endOn}（仅事发日落在此区间的记忆可入选）
                </Notice>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">
                  未识别相对时间窗，按普通关键词与重要度选择。
                </p>
              )}
              {preview.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">
                  没有可用的 Memory 记忆。
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {preview.map((trace) => (
                    <li key={trace.memoryId}>
                      {trace.selected ? "入选" : "未入选"} · 总分{" "}
                      {trace.scores.total.toFixed(3)} · {trace.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </Collapsible>

      <div className="flex flex-wrap items-end gap-2">
        <input
          className="field max-w-xs"
          placeholder="搜索记忆内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="btn" onClick={() => void create()}>
          新建记忆
        </button>
        <ConfirmButton
          label="删除所有记忆"
          confirmLabel="确认全部删除"
          disabled={items.length === 0}
          onConfirm={() => void removeAll()}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState>还没有已确认的记忆。</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((item) => (
            <li key={item.id} className="card space-y-3 p-3">
              <SectionTitle>{labelOf(MEMORY_TYPE_LABELS, item.type)}</SectionTitle>
              <textarea
                className="field min-h-16"
                value={item.content}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, content: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="类型">
                  <select
                    className="field"
                    value={item.type}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, type: event.target.value as MemoryType }
                            : entry,
                        ),
                      )
                    }
                  >
                    {MEMORY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {labelOf(MEMORY_TYPE_LABELS, type)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`重要度 ${item.importance}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    className="w-full"
                    value={item.importance}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, importance: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="启用">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, enabled: event.target.checked }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="置顶">
                  <input
                    type="checkbox"
                    checked={item.pinned}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, pinned: event.target.checked }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="事发日">
                  <input
                    type="date"
                    className="field"
                    value={item.occurredOn ?? ""}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                occurredOn: event.target.value || null,
                                occurredPrecision: event.target.value
                                  ? entry.occurredPrecision === "unknown"
                                    ? "day"
                                    : entry.occurredPrecision
                                  : "unknown",
                                timeSource: "manual",
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="事发结束日（可选）">
                  <input
                    type="date"
                    className="field"
                    value={item.occurredEndOn ?? ""}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                occurredEndOn: event.target.value || null,
                                timeSource: "manual",
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="事发精度">
                  <select
                    className="field"
                    value={item.occurredPrecision}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                occurredPrecision: event.target
                                  .value as MemoryItem["occurredPrecision"],
                                timeSource: "manual",
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="day">日</option>
                    <option value="week">周</option>
                    <option value="month">月</option>
                    <option value="unknown">未知</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <span>来源 {labelOf(MEMORY_SOURCE_LABELS, item.source.kind)}</span>
                <span>使用 {item.useCount} 次</span>
                <span>更新于 {formatDateTime(item.updatedAt)}</span>
                {item.occurredOn ? (
                  <span>
                    事发 {item.occurredOn}
                    {item.occurredEndOn ? `～${item.occurredEndOn}` : ""}
                  </span>
                ) : (
                  <span>无事发日锚定</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void update(item)}
                >
                  保存
                </button>
                <ConfirmButton
                  label="删除"
                  confirmLabel="确认删除"
                  onConfirm={() => remove(item.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
