"use client";

import { useEffect, useState } from "react";
import { ENERGY_LEVELS, type EnergyLevel } from "@/domain/common";
import type { SettingsData } from "@/domain/settings";
import {
  ContextPreviewBody,
  type PreviewResult,
} from "@/components/context-inspector/context-preview-body";
import { Field, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { ENERGY_LEVEL_LABELS, labelOf } from "@/lib/labels";

interface ConversationSummary {
  id: string;
  title: string;
}

/**
 * 在 Studio 里直接看提示词拼出来的样子。此前只有 Compare 页的抽屉能看，
 * 而且必须先建对话、写一句话，改一次提示词要跳两个页面才能验证。
 */
export function PromptPreview({
  profileId,
  settings,
  dirty,
}: {
  profileId: string;
  settings: SettingsData;
  dirty: boolean;
}) {
  const [userMessage, setUserMessage] = useState("今天什么都不想做");
  const [energy, setEnergy] = useState<EnergyLevel | "auto">("auto");
  const [slotId, setSlotId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slots = settings.compare.modelSlots.filter((slot) => slot.enabled);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.get<ConversationSummary[]>(
          `/api/conversations?profileId=${encodeURIComponent(profileId)}`,
        );
        if (!cancelled) setConversations(loaded);
      } catch {
        // 历史只是可选项，取不到就只提供「不带历史」。
        if (!cancelled) setConversations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const runPreview = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api.post<PreviewResult>("/api/context/preview", {
          profileId,
          userMessage,
          ...(slotId ? { modelSlotId: slotId } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(energy === "auto" ? {} : { energyOverride: energy }),
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Notice>
        预览用的是<strong>已保存</strong>的人格与预设。上面改了还没保存的内容不会体现在这里。
      </Notice>
      {dirty ? (
        <Notice tone="warning">
          当前有未保存的改动，先保存再预览才能看到效果。
        </Notice>
      ) : null}

      <Field label="测试用的一句话">
        <textarea
          className="field min-h-16"
          value={userMessage}
          onChange={(event) => setUserMessage(event.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="能量档位">
          <select
            className="field"
            value={energy}
            onChange={(event) =>
              setEnergy(event.target.value as EnergyLevel | "auto")
            }
          >
            <option value="auto">auto 按设置判定</option>
            {ENERGY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {labelOf(ENERGY_LEVEL_LABELS, level)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模型槽位" hint="只影响历史的槽位隔离，不会真的调用模型。">
          <select
            className="field"
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
          >
            <option value="">第一个启用的槽位</option>
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="带入哪段对话历史">
          <select
            className="field"
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
          >
            <option value="">不带历史</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={loading || !userMessage.trim()}
        onClick={() => void runPreview()}
      >
        {loading ? "构建中…" : "生成预览"}
      </button>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <ContextPreviewBody
          result={result}
          maxTotalChars={settings.context.maxTotalChars}
        />
      ) : null}
    </div>
  );
}
