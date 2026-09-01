"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FewShotSample } from "@/domain/fewshot";
import {
  type FewShotTextIssue,
  parseFewShotText,
  serializeFewShotSamples,
} from "@/domain/fewshot-text";
import { useProfiles } from "@/components/app-shell/profile-context";
import { ConfirmButton, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";

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

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const loaded = await api.get<FewShotSample[]>(
        `/api/fewshot?profileId=${encodeURIComponent(activeProfileId)}`,
      );
      setItems(loaded);
      setText(serializeFewShotSamples(loaded));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProfileId]);

  useEffect(() => {
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

      <Notice tone="warning">
        这批语料当前不进提示词。原来的检索器按能量档位硬过滤，绝大多数轮次一条都选不出来，
        已整体移除。语料本身保留为撰写素材，等 v1.1 的行为示例卡上线后重新接入并按新的检索规则生效。
      </Notice>

      <Notice>
        文本里已启用 {stats.enabled} 条，其中带世界观 {stats.worldview} 条（
        {stats.ratio}%）。
      </Notice>

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
