"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnergyLevel } from "@/domain/common";
import type { FewShotSample, FewShotSelectionTrace } from "@/domain/fewshot";
import {
  type FewShotTextIssue,
  parseFewShotText,
  serializeFewShotSamples,
} from "@/domain/fewshot-text";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import {
  Collapsible,
  ConfirmButton,
  Field,
  Notice,
} from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import {
  ENERGY_LEVEL_LABELS,
  FEW_SHOT_WORLDVIEW_LABELS,
  labelOf,
} from "@/lib/labels";

const ENERGY_LEVELS: readonly EnergyLevel[] = ["E0", "E1", "E2", "E3"];

interface BulkSaveSummary {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

export function FewShotView() {
  const { activeProfileId } = useProfiles();
  const [items, setItems] = useState<FewShotSample[]>([]);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<BulkSaveSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewInput, setPreviewInput] = useState("");
  const [previewLevel, setPreviewLevel] = useState<EnergyLevel>("E1");
  const [preview, setPreview] = useState<FewShotSelectionTrace[] | null>(null);
  const [injection, setInjection] = useState<
    SettingsData["context"]["fewShot"] | null
  >(null);
  const [togglingInjection, setTogglingInjection] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    const query = `profileId=${encodeURIComponent(activeProfileId)}`;
    try {
      const [loaded, settings] = await Promise.all([
        api.get<FewShotSample[]>(`/api/fewshot?${query}`),
        api.get<SettingsData>(`/api/settings?${query}`),
      ]);
      setItems(loaded);
      setText(serializeFewShotSamples(loaded));
      setInjection(settings.context.fewShot);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProfileId]);

  /** 只改这一个开关，其余设置先重新读一遍再写回，免得覆盖设置页刚存的改动。 */
  const setInjectionEnabled = async (enabled: boolean): Promise<void> => {
    if (!activeProfileId) return;
    setTogglingInjection(true);
    try {
      const current = await api.get<SettingsData>(
        `/api/settings?profileId=${encodeURIComponent(activeProfileId)}`,
      );
      const next: SettingsData = {
        ...current,
        context: {
          ...current.context,
          fewShot: { ...current.context.fewShot, enabled },
        },
      };
      await api.put("/api/settings", {
        profileId: activeProfileId,
        settings: next,
      });
      setInjection(next.context.fewShot);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTogglingInjection(false);
    }
  };

  useEffect(() => {
    setPreview(null);
    setSummary(null);
    void load();
  }, [load]);

  const parsed = useMemo(() => parseFewShotText(text), [text]);
  const saved = useMemo(() => serializeFewShotSamples(items), [items]);
  const dirty = text !== saved;
  const removing = items.length - parsed.records.length;

  const save = async (): Promise<void> => {
    if (!activeProfileId) return;
    try {
      const result = await api.put<{
        items: FewShotSample[];
        created: number;
        updated: number;
        unchanged: number;
        deleted: number;
      }>("/api/fewshot/bulk", { profileId: activeProfileId, text });
      setItems(result.items);
      setText(serializeFewShotSamples(result.items));
      setSummary({
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        deleted: result.deleted,
      });
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const runPreview = async (): Promise<void> => {
    if (!activeProfileId || !previewInput.trim()) return;
    try {
      const result = await api.post<{ trace: FewShotSelectionTrace[] }>(
        "/api/fewshot/preview-selection",
        {
          profileId: activeProfileId,
          userMessage: previewInput,
          energyLevel: previewLevel,
        },
      );
      setPreview(result.trace);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const stats = useMemo(() => {
    const enabled = parsed.records.filter((record) => record.enabled);
    const worldview = enabled.filter((record) => record.worldview !== "none");
    return {
      enabled: enabled.length,
      worldview: worldview.length,
      ratio:
        enabled.length === 0
          ? 0
          : Math.round((worldview.length / enabled.length) * 100),
    };
  }, [parsed.records]);

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;

  return (
    <div className="space-y-4 pb-10">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={injection?.enabled ?? false}
            disabled={injection === null || togglingInjection}
            onChange={(event) =>
              void setInjectionEnabled(event.target.checked)
            }
          />
          向提示词注入 Few-shot 示例
        </label>
        <span className="text-xs text-[var(--color-muted)]">
          {injection === null
            ? "正在读设置…"
            : injection.enabled
              ? `每轮上限 E0 ${injection.maxPerLevel.E0} / E1 ${injection.maxPerLevel.E1} / E2 ${injection.maxPerLevel.E2} / E3 ${injection.maxPerLevel.E3} 条，相关度阈值 ${injection.minScore}`
              : "关闭中：语料仍然保留，但任何一轮都不会注入示例，可用来做开关对照"}
        </span>
        <span className="text-xs text-[var(--color-muted)]">
          改的是 <code>data/settings.json</code> 的{" "}
          <code>context.fewShot.enabled</code>，其余参数在设置页的上下文编辑器里。
        </span>
      </div>

      <Notice>
        样本按当前这句话检索，每轮注入条数由设置里的能量档位决定。带世界观的样本每轮最多进一条，避免示例整批都是雨林联想。文本里已启用 {stats.enabled} 条，其中带世界观 {stats.worldview} 条（{stats.ratio}%）。
      </Notice>

      <Collapsible title="选择预览（只读，不写入任何数据）">
        <div className="space-y-2">
          <textarea
            className="field min-h-16"
            placeholder="输入一句话，查看哪些样本会被选中"
            value={previewInput}
            onChange={(event) => setPreviewInput(event.target.value)}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Field label="按哪个能量档位预览">
              <select
                className="field"
                value={previewLevel}
                onChange={(event) =>
                  setPreviewLevel(event.target.value as EnergyLevel)
                }
              >
                {ENERGY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {labelOf(ENERGY_LEVEL_LABELS, level)}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className="btn"
              disabled={!previewInput.trim()}
              onClick={() => void runPreview()}
            >
              预览选择
            </button>
            {dirty ? (
              <span className="text-xs text-[var(--color-danger)]">
                预览用的是已保存的内容，下面未保存的改动不算数。
              </span>
            ) : null}
          </div>

          {preview ? (
            preview.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                这个档案还没有样本。
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.map((trace) => (
                  <li key={trace.sampleId}>
                    {trace.selected ? "入选" : "未入选"} · {trace.scene} ·{" "}
                    {labelOf(FEW_SHOT_WORLDVIEW_LABELS, trace.worldview)} · 相关度{" "}
                    {trace.score.toFixed(3)} · {trace.reason}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </Collapsible>

      <Notice>
        整份语料在下面一个框里编辑，保存时按 id 认回原来的样本。记录之间用单独一行{" "}
        <code>---</code> 分隔，方括号里是 id，新增记录不写这一行即可；删掉某一整段就是删除那条样本。字段值可以换行续写。
      </Notice>

      <textarea
        className="field min-h-[36rem] font-mono text-xs"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      {parsed.issues.length > 0 ? (
        <Notice tone="error">
          <p>文本有 {parsed.issues.length} 处问题，修好才能保存：</p>
          <ul className="mt-1 space-y-0.5">
            {parsed.issues.slice(0, 10).map((issue: FewShotTextIssue) => (
              <li key={`${issue.line}-${issue.message}`}>
                第 {issue.line} 行 · {issue.message}
              </li>
            ))}
          </ul>
          {parsed.issues.length > 10 ? <p className="mt-1">…还有更多。</p> : null}
        </Notice>
      ) : null}

      {summary ? (
        <Notice>
          已保存：新增 {summary.created} 条，修改 {summary.updated} 条，删除{" "}
          {summary.deleted} 条，未变动 {summary.unchanged} 条。
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {removing > 0 ? (
          <ConfirmButton
            className="btn btn-primary"
            label={`保存（会删掉 ${removing} 条）`}
            confirmLabel={`确认删掉 ${removing} 条并保存`}
            onConfirm={save}
            disabled={parsed.issues.length > 0 || !dirty}
          />
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={parsed.issues.length > 0 || !dirty}
            onClick={() => void save()}
          >
            保存
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={!dirty}
          onClick={() => setText(saved)}
        >
          放弃改动
        </button>
        <span className="text-xs text-[var(--color-muted)]">
          文本里 {parsed.records.length} 条，库里 {items.length} 条
          {dirty ? " · 未保存" : ""}
        </span>
      </div>
    </div>
  );
}
