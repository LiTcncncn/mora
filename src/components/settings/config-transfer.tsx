"use client";

import { useEffect, useRef, useState } from "react";
import { Collapsible, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";

/**
 * §13.5 的 Config Transfer 分组：导出、导入、备份恢复的操作入口。
 * 包结构、排除清单与 hash 计算范围为只读，由 §13.6 定义，界面不提供开关。
 */

const EXPORT_KINDS = [
  { kind: "mora_behavior_config", label: "完整配置（含三类内容资产）" },
  { kind: "mora_worldview_library", label: "世界观素材库（事实 + 种子）" },
  { kind: "mora_example_library", label: "行为示例卡库" },
] as const;

interface AssetDelta {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

interface ImportPreview {
  kind: string;
  sourceGeneration: 1 | 2;
  sourceProfileName: string;
  declaredConfigHash: string | null;
  recomputedConfigHash: string;
  hashMismatch: boolean;
  downgrades: Array<{ field: string; from: string; to: string }>;
  rejected: boolean;
  rejectionReasons: Array<{ code: string; message: string }>;
  autoDisabled: Array<{ target: { kind: string; id: string }; reason: string }>;
  warnings: Array<{ code: string; message: string }>;
  strategyOverrides: Array<{ mode: string; field: string }>;
  changeSummary: {
    canonFacts: AssetDelta;
    worldviewSeeds: AssetDelta;
    exampleCards: AssetDelta;
    changedSettingGroups: string[];
  };
  migration: {
    fewShotSource: "absent" | "explicit_empty" | "present";
    fewShotSampleCount: number;
    exampleCardCandidates: number;
    seedCandidatesPending: Array<{ sourceSampleId: string; scene: string }>;
    notes: string[];
  } | null;
}

interface ImportResponse {
  applied: boolean;
  preview: ImportPreview;
}

interface BackupEntry {
  fileName: string;
  configHash: string;
  createdAt: string;
  sizeBytes: number;
}

const ASSET_LABELS: Record<string, string> = {
  canonFacts: "世界观事实",
  worldviewSeeds: "世界观种子",
  exampleCards: "行为示例卡",
};

const MIGRATION_SOURCE_LABELS: Record<string, string> = {
  absent: "源配置不含样本字段，现有语料保持不动",
  explicit_empty: "源配置显式清空样本",
  present: "源配置含样本",
};

export function ConfigTransfer({
  profileId,
  onImported,
}: {
  profileId: string;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ contents: string; fileName: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refreshBackups = async (): Promise<void> => {
    try {
      const result = await api.get<{ items: BackupEntry[] }>(
        "/api/behavior-config/backups",
      );
      setBackups(result.items);
    } catch {
      // 备份列表拿不到不该挡住导出导入本身。
      setBackups([]);
    }
  };

  useEffect(() => {
    void refreshBackups();
  }, []);

  const reset = (): void => {
    setPending(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const runPreview = async (file: File): Promise<void> => {
    setError(null);
    setStatus(null);
    const contents = await file.text();

    try {
      const result = await api.post<ImportResponse>(
        "/api/behavior-config/import",
        { profileId, fileContents: contents, fileName: file.name, confirmed: false },
      );
      setPending({ contents, fileName: file.name });
      setPreview(result.preview);
    } catch (caught) {
      reset();
      setError(errorMessage(caught));
    }
  };

  const apply = async (): Promise<void> => {
    if (!pending) return;
    setError(null);

    try {
      // 重新提交文件原文而不是提交预览结果：让客户端持有一份已通过校验的
      // 配置再收回来，等于给它篡改的机会。
      await api.post<ImportResponse>("/api/behavior-config/import", {
        profileId,
        fileContents: pending.contents,
        fileName: pending.fileName,
        confirmed: true,
      });
      reset();
      setStatus("配置已导入。导入前的配置已自动备份，可在下方一键恢复。");
      await refreshBackups();
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const restore = async (fileName: string): Promise<void> => {
    setError(null);
    setStatus(null);

    try {
      await api.post("/api/behavior-config/backups", {
        profileId,
        fileName,
        confirmed: true,
      });
      setStatus(`已恢复备份 ${fileName}。恢复动作本身也已备份，可再次撤回。`);
      await refreshBackups();
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Collapsible title="配置导出与导入">
      <div className="space-y-4">
        <Notice>
          配置文件包含行为参数与三类内容资产（世界观事实、世界观种子、行为示例卡），
          不含 API Key 接口密钥、对话、Memory 记忆、run 运行记录、重大事件指纹、
          策略提案或世界观调度状态。安全底线由程序提供，不会被配置文件覆盖。
        </Notice>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {status ? <Notice>{status}</Notice> : null}

        <section className="space-y-2">
          <h4 className="text-sm font-medium">导出</h4>
          <div className="flex flex-wrap gap-2">
            {EXPORT_KINDS.map((item) => (
              <a
                key={item.kind}
                className="btn inline-flex"
                href={`/api/behavior-config/export?profileId=${encodeURIComponent(profileId)}&kind=${item.kind}`}
                download
              >
                {item.label}
              </a>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            文件名含 configHash 前 8 位，可在不打开文件的情况下判断两份导出是否相同。
          </p>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-medium">导入</h4>
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            className="block text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void runPreview(file);
            }}
          />
          <p className="text-xs text-[var(--color-muted)]">
            v1 配置文件可直接导入，系统会先生成迁移预览。导入前必须确认，
            该确认不可跳过。
          </p>

          {preview ? (
            <ImportPreviewCard
              preview={preview}
              onApply={() => void apply()}
              onCancel={reset}
            />
          ) : null}
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-medium">备份</h4>
          {backups.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              暂无备份。每次导入与恢复前会自动备份，最多保留最近 20 份。
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {backups.map((entry) => (
                <li key={entry.fileName} className="flex items-center gap-2">
                  <span className="font-mono text-xs">{entry.configHash}</span>
                  <span className="text-[var(--color-muted)]">
                    {entry.createdAt}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void restore(entry.fileName)}
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            恢复走与导入完全相同的三阶段流程，同样会先备份当前配置。
          </p>
        </section>
      </div>
    </Collapsible>
  );
}

function ImportPreviewCard({
  preview,
  onApply,
  onCancel,
}: {
  preview: ImportPreview;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="card space-y-3 p-3 text-sm">
      <p>
        来源档案：{preview.sourceProfileName} · 文件版本 v
        {preview.sourceGeneration} · {preview.kind}
      </p>

      {preview.rejected ? (
        <Notice tone="error">
          <p className="font-medium">
            未通过硬约束校验，整包已拒绝。不做部分导入。
          </p>
          <ul className="mt-1 list-disc pl-4">
            {preview.rejectionReasons.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {preview.hashMismatch ? (
        <Notice tone="warning">
          文件内的 configHash（{preview.declaredConfigHash}）与重算结果（
          {preview.recomputedConfigHash}）不一致，说明这份文件被手工编辑过。
          这不阻塞导入，但请确认改动是预期的。
        </Notice>
      ) : null}

      {preview.downgrades.length > 0 ? (
        <Notice tone="warning">
          <p className="font-medium">这是一次降级。</p>
          <ul className="mt-1 list-disc pl-4">
            {preview.downgrades.map((entry) => (
              <li key={entry.field}>
                {entry.field}：{entry.from} → {entry.to}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div>
        <p className="font-medium">内容资产变更</p>
        <ul className="text-[var(--color-muted)]">
          {(["canonFacts", "worldviewSeeds", "exampleCards"] as const).map(
            (key) => {
              const delta = preview.changeSummary[key];
              return (
                <li key={key}>
                  {ASSET_LABELS[key]}：新增 {delta.added} · 修改 {delta.changed} ·
                  移除 {delta.removed} · 不变 {delta.unchanged}
                </li>
              );
            },
          )}
        </ul>
        {preview.changeSummary.changedSettingGroups.length > 0 ? (
          <p className="text-[var(--color-muted)]">
            参数分组变更：{preview.changeSummary.changedSettingGroups.join("、")}
          </p>
        ) : null}
      </div>

      {preview.autoDisabled.length > 0 ? (
        <div>
          <p className="font-medium">
            以下 {preview.autoDisabled.length} 条会被导入但自动禁用
          </p>
          <ul className="list-disc pl-4 text-[var(--color-muted)]">
            {preview.autoDisabled.map((entry) => (
              <li key={`${entry.target.kind}-${entry.target.id}`}>
                {entry.target.id}：{entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.strategyOverrides.length > 0 ? (
        <p className="text-[var(--color-muted)]">
          文件里的只读策略文本已被拉回代码常量：
          {preview.strategyOverrides
            .map((entry) => `${entry.mode}.${entry.field}`)
            .join("、")}
        </p>
      ) : null}

      {preview.migration ? (
        <div>
          <p className="font-medium">迁移报告</p>
          <p className="text-[var(--color-muted)]">
            {MIGRATION_SOURCE_LABELS[preview.migration.fewShotSource]}
            （{preview.migration.fewShotSampleCount} 条），生成{" "}
            {preview.migration.exampleCardCandidates} 张待审核示例卡。
          </p>
          {preview.migration.seedCandidatesPending.length > 0 ? (
            <p className="text-[var(--color-muted)]">
              {preview.migration.seedCandidatesPending.length}{" "}
              条样本含显性世界观，需人工另写世界观种子。
            </p>
          ) : null}
          <ul className="list-disc pl-4 text-[var(--color-muted)]">
            {preview.migration.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.warnings.length > 0 ? (
        <div>
          <p className="font-medium">警告（不阻塞导入）</p>
          <ul className="list-disc pl-4 text-[var(--color-muted)]">
            {preview.warnings.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex gap-2">
        {preview.rejected ? null : (
          <button type="button" className="btn btn-primary" onClick={onApply}>
            确认导入
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
