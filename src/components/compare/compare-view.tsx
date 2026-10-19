"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CALL_FAILED_TEXT, ENERGY_LEVELS, type EnergyLevel } from "@/domain/common";
import type { Conversation, ConversationMessage } from "@/domain/conversation";
import type { MemoryItem } from "@/domain/memory";
import type { RunSummary } from "@/domain/run";
import type { SettingsData } from "@/domain/settings";
import { useAuth } from "@/components/app-shell/auth-context";
import { useProfiles } from "@/components/app-shell/profile-context";
import { ContextInspector } from "@/components/context-inspector/context-inspector";
import { RunInspector } from "@/components/runs/run-inspector";
import { ConfirmButton, EmptyState, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import {
  appendLocalMessages,
  loadLocalChat,
  replaceLocalMemories,
  saveLocalChat,
} from "@/lib/local-chat-store";
import { ENERGY_LEVEL_LABELS, labelOf } from "@/lib/labels";
import type {
  VoiceTurnContext,
  VoiceTurnDone,
} from "@/components/voice/use-voice-session";
import { VoiceSessionPanel } from "@/components/voice/voice-session-panel";
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
  userMessageId: string;
  configHash?: string;
  candidates: Array<{
    modelSlotId: string;
    slotLabel: string;
    provider: string;
    modelId: string;
    status: "succeeded" | "failed";
    displayText: string;
    assistantMessageId: string | null;
  }>;
  memoryExtraction: {
    status: "succeeded" | "failed" | "disabled";
    candidateIds: string[];
    displayText: string;
    candidates?: MemoryItem[];
  };
}

export function CompareView() {
  const { user } = useAuth();
  const { activeProfileId } = useProfiles();
  const isGuest = user?.role === "guest";

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [localMemories, setLocalMemories] = useState<MemoryItem[]>([]);
  const [configHint, setConfigHint] = useState<string | null>(null);
  const lastConfigHashRef = useRef<string | null>(null);

  const [draft, setDraft] = useState("");
  const [energyOverride, setEnergyOverride] = useState<EnergyLevel | "auto">(
    "auto",
  );
  const [sending, setSending] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CompareResponse | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  const profileId = activeProfileId ?? "profile-default";

  const loadConversations = useCallback(async () => {
    if (isGuest || !activeProfileId) return;
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
  }, [activeProfileId, isGuest]);

  const loadConversation = useCallback(async () => {
    if (isGuest) return;
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
  }, [activeProfileId, conversationId, isGuest]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const loadedSettings = await api.get<SettingsData>(
          `/api/settings?profileId=${encodeURIComponent(profileId)}`,
        );
        setSettings(loadedSettings);
        if (isGuest) {
          const local = loadLocalChat(user.id);
          setConversation(local.conversation);
          setConversationId(local.conversation.id);
          setLocalMemories(local.memories);
          lastConfigHashRef.current = local.lastConfigHash;
          setConversations([
            {
              id: local.conversation.id,
              title: local.conversation.title,
              updatedAt: local.conversation.updatedAt,
              messageCount: local.conversation.messages.length,
            },
          ]);
        } else if (activeProfileId) {
          await loadConversations();
        }
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    })();
  }, [user, isGuest, profileId, activeProfileId, loadConversations]);

  useEffect(() => {
    if (isGuest) return;
    void loadConversation().catch((caught: unknown) =>
      setError(errorMessage(caught)),
    );
  }, [loadConversation, isGuest]);

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
    if (isGuest && user) {
      const now = new Date().toISOString();
      const next = {
        conversation: {
          id: `local-conv-${user.id}-${Date.now()}`,
          profileId: "profile-default",
          title: `对话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
          createdAt: now,
          updatedAt: now,
          messages: [] as ConversationMessage[],
        },
        memories: localMemories,
        lastConfigHash: lastConfigHashRef.current,
      };
      saveLocalChat(user.id, next);
      setConversation(next.conversation);
      setConversationId(next.conversation.id);
      setConversations([
        {
          id: next.conversation.id,
          title: next.conversation.title,
          updatedAt: next.conversation.updatedAt,
          messageCount: 0,
        },
      ]);
      return;
    }
    if (!activeProfileId) return;
    const created = await api.post<Conversation>("/api/conversations", {
      profileId: activeProfileId,
      title: `对话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    });
    await loadConversations();
    setConversationId(created.id);
  };

  const renameConversation = async (): Promise<void> => {
    if (isGuest || !activeProfileId || !conversationId || !conversation) return;
    const title = window.prompt("新的对话名称", conversation.title);
    if (!title?.trim()) return;
    await api.put(`/api/conversations/${conversationId}`, {
      profileId: activeProfileId,
      title: title.trim(),
    });
    await loadConversations();
    await loadConversation();
  };

  const clearLocalMemories = async (): Promise<void> => {
    if (!isGuest || !user) return;
    const next = replaceLocalMemories(user.id, []);
    setLocalMemories(next.memories);
    setLastResult(null);
  };

  const deleteConversation = async (): Promise<void> => {
    if (isGuest) return;
    if (!activeProfileId || !conversationId) return;
    await api.delete(
      `/api/conversations/${conversationId}?profileId=${encodeURIComponent(activeProfileId)}`,
    );
    setConversationId(null);
    setConversation(null);
    setRuns([]);
    setLastResult(null);
    await loadConversations();
  };

  const deleteAllConversations = async (): Promise<void> => {
    setError(null);
    try {
      if (isGuest && user) {
        await createConversation();
        setRuns([]);
        setLastResult(null);
        return;
      }
      if (!activeProfileId) return;
      await api.delete(
        `/api/conversations?profileId=${encodeURIComponent(activeProfileId)}`,
      );
      setConversation(null);
      setConversationId(null);
      setRuns([]);
      setLastResult(null);
      await loadConversations();
      await createConversation();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const noteConfigHash = (configHash: string | undefined): void => {
    if (!configHash) return;
    if (lastConfigHashRef.current && lastConfigHashRef.current !== configHash) {
      setConfigHint("配置已更新，本轮起按最新设置回复。");
    }
    lastConfigHashRef.current = configHash;
  };

  const getVoiceTurnContext = (): VoiceTurnContext | null => {
    if (!conversationId || !user) return null;
    if (!isGuest) return { profileId, conversationId };
    const local = loadLocalChat(user.id);
    return {
      profileId,
      conversationId,
      clientMessages: local.conversation.messages,
      clientMemories: local.memories.filter(
        (item) => item.enabled && item.status === "active",
      ),
    };
  };

  const handleVoiceTurnDone = async (event: VoiceTurnDone): Promise<void> => {
    noteConfigHash(event.configHash);
    if (!isGuest || !user) {
      await loadConversation();
      return;
    }
    const local = loadLocalChat(user.id);
    let memories = local.memories;
    if (event.memoryExtraction.candidates?.length) {
      memories = [...memories, ...event.memoryExtraction.candidates];
      setLocalMemories(memories);
    }
    const messages = [
      event.userMessage,
      ...(event.assistantMessage ? [{ ...event.assistantMessage, runId: null }] : []),
    ];
    const bundle = appendLocalMessages(user.id, messages, {
      memories,
      lastConfigHash: event.configHash,
    });
    setConversation(bundle.conversation);
    setConversations([
      {
        id: bundle.conversation.id,
        title: bundle.conversation.title,
        updatedAt: bundle.conversation.updatedAt,
        messageCount: bundle.conversation.messages.length,
      },
    ]);
  };

  const send = async (): Promise<void> => {
    if (!conversationId || !draft.trim() || !user) return;
    setSending(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        profileId,
        conversationId,
        userMessage: draft.trim(),
        ...(energyOverride === "auto" ? {} : { energyOverride }),
      };

      if (isGuest) {
        const local = loadLocalChat(user.id);
        payload.clientPersist = true;
        payload.clientMessages = local.conversation.messages;
        payload.clientMemories = local.memories.filter(
          (item) => item.enabled && item.status === "active",
        );
      }

      const result = await api.post<CompareResponse>("/api/compare", payload);
      setLastResult(result);
      noteConfigHash(result.configHash);

      if (isGuest) {
        const now = new Date().toISOString();
        const userMessage: ConversationMessage = {
          id: result.userMessageId,
          role: "user",
          content: draft.trim(),
          createdAt: now,
          runId: null,
          modelSlotId: null,
          provider: null,
          modelId: null,
          comparisonGroupId: result.comparisonGroupId,
        };
        const assistantMessages: ConversationMessage[] = result.candidates
          .filter((item) => item.status === "succeeded" && item.assistantMessageId)
          .map((item) => ({
            id: item.assistantMessageId!,
            role: "assistant" as const,
            content: item.displayText,
            createdAt: now,
            runId: null,
            modelSlotId: item.modelSlotId,
            provider: item.provider as ConversationMessage["provider"],
            modelId: item.modelId,
            comparisonGroupId: result.comparisonGroupId,
          }));

        let memories = localMemories;
        if (result.memoryExtraction.candidates?.length) {
          memories = [...localMemories, ...result.memoryExtraction.candidates];
          replaceLocalMemories(user.id, memories);
          setLocalMemories(memories);
        }

        const bundle = appendLocalMessages(user.id, [userMessage, ...assistantMessages], {
          memories,
          lastConfigHash: result.configHash ?? lastConfigHashRef.current,
        });
        setConversation(bundle.conversation);
        setConversations([
          {
            id: bundle.conversation.id,
            title: bundle.conversation.title,
            updatedAt: bundle.conversation.updatedAt,
            messageCount: bundle.conversation.messages.length,
          },
        ]);
      } else {
        await loadConversation();
      }

      setDraft("");
    } catch (caught) {
      setError(errorMessage(caught));
      if (!isGuest) await loadConversation();
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return <EmptyState>正在验证登录…</EmptyState>;
  }

  if (!isGuest && !activeProfileId) {
    return <EmptyState>正在加载配置…</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {!isGuest ? (
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
            disabled={!conversationId}
            onConfirm={() => void deleteConversation()}
          />
          <ConfirmButton
            label="删除所有对话"
            confirmLabel="确认全部删除"
            disabled={conversations.length === 0}
            onConfirm={() => void deleteAllConversations()}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>聊天与记忆保存在本机浏览器。</span>
          <ConfirmButton
            label="删除所有对话"
            confirmLabel="确认清空对话"
            onConfirm={() => void deleteAllConversations()}
          />
          <ConfirmButton
            label="清空本地记忆"
            confirmLabel="确认清空"
            onConfirm={() => void clearLocalMemories()}
          />
        </div>
      )}

      {enabledSlots.length === 0 ? (
        <Notice tone="error">
          {isGuest
            ? "管理员尚未启用任何模型槽位。"
            : "当前没有启用任何模型槽位，请先到设置页启用至少一个。"}
        </Notice>
      ) : null}

      {configHint ? <Notice>{configHint}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {lastResult ? (
        <div className="text-xs text-[var(--color-muted)]">
          Memory：
          {lastResult.memoryExtraction.status === "succeeded"
            ? isGuest
              ? `已写入本地 ${lastResult.memoryExtraction.candidateIds.length} 条`
              : `新增 ${lastResult.memoryExtraction.candidateIds.length} 条记忆`
            : lastResult.memoryExtraction.status === "disabled"
              ? "已关闭"
              : CALL_FAILED_TEXT}
        </div>
      ) : null}

      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {!conversation ? (
          <EmptyState>请选择或新建一个对话。</EmptyState>
        ) : turns.length === 0 ? (
          <EmptyState>还没有消息。写一句话开始聊天。</EmptyState>
        ) : (
          turns.map((turn) => (
            <section key={turn.comparisonGroupId} className="space-y-1.5">
              <div className="px-1 py-0.5">
                <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">
                  <span className="text-[var(--color-muted)]">我：</span>
                  {turn.userMessage.content}
                </p>
              </div>
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 280px), 1fr))`,
                }}
              >
                {turn.lanes.map((lane) => (
                  <ModelCell
                    key={lane.slot.id}
                    lane={lane}
                    onOpenRun={isGuest ? undefined : setOpenRunId}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t bg-white p-3">
        <VoiceSessionPanel
          slots={enabledSlots}
          disabled={!conversationId || sending}
          getTurnContext={getVoiceTurnContext}
          onTurnDone={handleVoiceTurnDone}
          onError={setError}
          onActiveChange={setVoiceActive}
        />
        <input
          type="text"
          className="field"
          placeholder="写一句话…"
          value={draft}
          disabled={!conversationId || sending || voiceActive}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!conversationId || sending || !draft.trim()) return;
            void send();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {!isGuest ? (
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">本轮 Energy</span>
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
          ) : null}
          {!isGuest ? (
            <button
              type="button"
              className="btn"
              disabled={!conversationId || !draft.trim()}
              onClick={() => setInspectorOpen(true)}
            >
              预览 Context
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary ml-auto"
            disabled={
              !conversationId ||
              !draft.trim() ||
              sending ||
              voiceActive ||
              enabledSlots.length === 0
            }
            onClick={() => void send()}
          >
            {sending ? `正在调用 ${enabledSlots.length} 个模型…` : "发送"}
          </button>
        </div>
      </div>

      {!isGuest && inspectorOpen && conversationId ? (
        <ContextInspector
          profileId={profileId}
          conversationId={conversationId}
          userMessage={draft}
          slots={enabledSlots}
          energyOverride={energyOverride}
          onClose={() => setInspectorOpen(false)}
        />
      ) : null}
      {!isGuest && openRunId ? (
        <RunInspector
          profileId={profileId}
          runId={openRunId}
          onClose={() => setOpenRunId(null)}
        />
      ) : null}
    </div>
  );
}
