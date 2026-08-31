"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CALL_FAILED_TEXT, ENERGY_LEVELS, type EnergyLevel } from "@/domain/common";
import type { Conversation } from "@/domain/conversation";
import type { RunSummary } from "@/domain/run";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import { ContextInspector } from "@/components/context-inspector/context-inspector";
import { RunInspector } from "@/components/runs/run-inspector";
import { ConfirmButton, EmptyState, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { shortHash } from "@/lib/format";
import { ENERGY_LEVEL_LABELS, labelOf } from "@/lib/labels";
import { ModelCell } from "./model-cell";
import { buildTurns } from "./turns";

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface CompareResponse {
  comparisonGroupId: string;
  sharedContextHash: string;
  memoryExtraction: {
    status: "succeeded" | "failed" | "disabled";
    candidateIds: string[];
    displayText: string;
  };
}

export function CompareView() {
  const { activeProfileId } = useProfiles();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);

  const [draft, setDraft] = useState("");
  const [energyOverride, setEnergyOverride] = useState<EnergyLevel | "auto">(
    "auto",
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CompareResponse | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!activeProfileId) return;
    const items = await api.get<ConversationSummary[]>(
      `/api/conversations?profileId=${encodeURIComponent(activeProfileId)}`,
    );
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setConversations(items);
    setConversationId((current) =>
      current && items.some((item) => item.id === current)
        ? current
        : (items[0]?.id ?? null),
    );
  }, [activeProfileId]);

  const loadConversation = useCallback(async () => {
    if (!activeProfileId || !conversationId) {
      setConversation(null);
      setRuns([]);
      return;
    }
    const query = `profileId=${encodeURIComponent(activeProfileId)}`;
    const [detail, runPage] = await Promise.all([
      api.get<Conversation>(`/api/conversations/${conversationId}?${query}`),
      api.get<{ items: RunSummary[] }>(
        `/api/runs?${query}&conversationId=${encodeURIComponent(conversationId)}&limit=200`,
      ),
    ]);
    setConversation(detail);
    setRuns(runPage.items);
  }, [activeProfileId, conversationId]);

  useEffect(() => {
    if (!activeProfileId) return;
    setConversation(null);
    setRuns([]);
    setLastResult(null);
    void (async () => {
      try {
        const [, loadedSettings] = await Promise.all([
          loadConversations(),
          api.get<SettingsData>(
            `/api/settings?profileId=${encodeURIComponent(activeProfileId)}`,
          ),
        ]);
        setSettings(loadedSettings);
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    })();
  }, [activeProfileId, loadConversations]);

  useEffect(() => {
    void loadConversation().catch((caught: unknown) =>
      setError(errorMessage(caught)),
    );
  }, [loadConversation]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [conversation?.messages.length, sending]);

  const enabledSlots = useMemo(
    () => settings?.compare.modelSlots.filter((slot) => slot.enabled) ?? [],
    [settings],
  );

  const turns = useMemo(() => {
    if (!conversation) return [];
    return buildTurns(conversation, runs, settings?.compare.modelSlots ?? []);
  }, [conversation, runs, settings]);

  const createConversation = async (): Promise<void> => {
    if (!activeProfileId) return;
    const created = await api.post<Conversation>("/api/conversations", {
      profileId: activeProfileId,
      title: `对话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    });
    await loadConversations();
    setConversationId(created.id);
  };

  const renameConversation = async (): Promise<void> => {
    if (!activeProfileId || !conversationId || !conversation) return;
    const title = window.prompt("新的对话名称", conversation.title);
    if (!title?.trim()) return;
    await api.put(`/api/conversations/${conversationId}`, {
      profileId: activeProfileId,
      title: title.trim(),
    });
    await loadConversations();
    await loadConversation();
  };

  const deleteConversation = async (): Promise<void> => {
    if (!activeProfileId || !conversationId) return;
    await api.delete(
      `/api/conversations/${conversationId}?profileId=${encodeURIComponent(activeProfileId)}`,
    );
    setConversationId(null);
    await loadConversations();
  };

  const send = async (): Promise<void> => {
    if (!activeProfileId || !conversationId || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.post<CompareResponse>("/api/compare", {
        profileId: activeProfileId,
        conversationId,
        userMessage: draft.trim(),
        ...(energyOverride === "auto" ? {} : { energyOverride }),
      });
      setLastResult(result);
      setDraft("");
      await loadConversation();
    } catch (caught) {
      setError(errorMessage(caught));
      await loadConversation();
    } finally {
      setSending(false);
    }
  };

  if (!activeProfileId) {
    return <EmptyState>正在加载测试档案…</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs sm:max-w-xs">
          <span className="label">对话</span>
          <select
            className="field mt-1"
            value={conversationId ?? ""}
            onChange={(event) => setConversationId(event.target.value || null)}
          >
            {conversations.length === 0 ? <option value="">暂无对话</option> : null}
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}（{item.messageCount}）
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void createConversation()}>
          新建对话
        </button>
        <button
          type="button"
          className="btn"
          disabled={!conversationId}
          onClick={() => void renameConversation()}
        >
          重命名
        </button>
        <ConfirmButton
          label="删除对话"
          confirmLabel="确认删除"
          onConfirm={() => void deleteConversation()}
        />
      </div>

      {enabledSlots.length === 0 ? (
        <Notice tone="error">
          当前档案没有启用任何模型槽位，请先到设置页启用至少一个。
        </Notice>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {lastResult ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
          <span className="mono">
            共享 Context hash 上下文指纹{" "}
            {shortHash(lastResult.sharedContextHash)}
          </span>
          <span>
            Memory 记忆候选提取：
            {lastResult.memoryExtraction.status === "succeeded"
              ? `新增 ${lastResult.memoryExtraction.candidateIds.length} 条记忆`
              : lastResult.memoryExtraction.status === "disabled"
                ? "已关闭"
                : CALL_FAILED_TEXT}
          </span>
        </div>
      ) : null}

      <div ref={threadRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        {!conversation ? (
          <EmptyState>请选择或新建一个对话。</EmptyState>
        ) : turns.length === 0 ? (
          <EmptyState>还没有消息。写一句话，所有启用的模型会同时回复。</EmptyState>
        ) : (
          turns.map((turn) => (
            <section key={turn.comparisonGroupId} className="space-y-3">
              <div className="card px-3 py-2">
                <div className="label">我</div>
                <p className="whitespace-pre-wrap break-words">
                  {turn.userMessage.content}
                </p>
                {turn.sharedContextHash ? (
                  <p className="mono mt-1 text-[var(--color-muted)]">
                    共享 Context 上下文 {shortHash(turn.sharedContextHash)} ·{" "}
                    {turn.lanesShareContext
                      ? "各槽位完整上下文一致"
                      : "各槽位历史已分叉"}
                  </p>
                ) : null}
              </div>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 280px), 1fr))`,
                }}
              >
                {turn.lanes.map((lane) => (
                  <ModelCell
                    key={lane.slot.id}
                    lane={lane}
                    onOpenRun={setOpenRunId}
                  />
                ))}
              </div>
            </section>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 space-y-2 border-t bg-white p-3">
        <input
          type="text"
          className="field"
          placeholder="写一句话，所有启用的模型会同时回复"
          value={draft}
          disabled={!conversationId || sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!conversationId || sending || !draft.trim()) return;
            void send();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-muted)]">
              本轮 Energy 能量档位
            </span>
            <select
              className="rounded border px-2 py-1"
              value={energyOverride}
              disabled={!settings?.energy.allowPerMessageOverride}
              onChange={(event) =>
                setEnergyOverride(event.target.value as EnergyLevel | "auto")
              }
            >
              <option value="auto">按设置自动判定</option>
              {ENERGY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {labelOf(ENERGY_LEVEL_LABELS, level)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!conversationId || !draft.trim()}
            onClick={() => setInspectorOpen(true)}
          >
            预览 Context 上下文
          </button>
          <button
            type="button"
            className="btn btn-primary ml-auto"
            disabled={
              !conversationId ||
              !draft.trim() ||
              sending ||
              enabledSlots.length === 0
            }
            onClick={() => void send()}
          >
            {sending ? `正在调用 ${enabledSlots.length} 个模型…` : "发送"}
          </button>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          发送后先判定 Energy 档位（llm 模式会多一次短调用），再并行调用各槽位，并额外提取记忆候选。
        </p>
      </div>

      {inspectorOpen && conversationId ? (
        <ContextInspector
          profileId={activeProfileId}
          conversationId={conversationId}
          userMessage={draft}
          slots={enabledSlots}
          energyOverride={energyOverride}
          onClose={() => setInspectorOpen(false)}
        />
      ) : null}

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
